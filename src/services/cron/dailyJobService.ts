import {
  billingPeriodRepository,
  communicationRepository,
  jobLockRepository,
  subscriptionRepository
} from "../../infrastructure/firestore/repositories.js";
import { billingService } from "../billing/billingService.js";
import { notificationService } from "../notifications/notificationService.js";
import { activityLogService } from "../audit/activityLogService.js";
import { clientService } from "../clients/clientService.js";
import { CommunicationType, SubscriptionStatus, UserRole } from "../../domain/types.js";
import type { BillingPeriod, RequestContext, Subscription, Client } from "../../domain/models.js";
import { addDays, toDateString } from "../../domain/dateUtils.js";

interface JobResult {
  organizationId: string;
  date: string;
  status: string;
  reminded: number;
  notifiedOnDueDate: number;
  markedOverdue: number;
  suspended: number;
  errors: string[];
  timestamp: string;
}

export const dailyJobService = {
  async run(context: RequestContext): Promise<JobResult> {
    const today = toDateString(new Date());
    const result: JobResult = {
      organizationId: context.organizationId,
      date: today,
      status: "completed",
      reminded: 0,
      notifiedOnDueDate: 0,
      markedOverdue: 0,
      suspended: 0,
      errors: [],
      timestamp: new Date().toISOString()
    };

    const acquired = await jobLockRepository.tryAcquire(context.organizationId, today, "daily");

    if (!acquired) {
      return { ...result, status: "already_executed" };
    }

    try {
      const subscriptions = await subscriptionRepository.listAll(context.organizationId);
      const activeSubscriptions = subscriptions.filter(
        (sub) => sub.status === SubscriptionStatus.Active
      );

      for (const subscription of activeSubscriptions) {
        try {
          await processSubscription(context, subscription, today, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error desconocido";
          result.errors.push(`${subscription.starlinkAccountId}: ${message}`);
        }
      }

      // CRÍTICO: Liberar lock con status "completed" al finalizar exitosamente
      await jobLockRepository.release(context.organizationId, today, "daily", "completed");

      await activityLogService.log({
        context: {
          ...context,
          userId: "cron-daily",
          role: UserRole.Admin
        },
        action: "cron.daily_executed",
        entityType: "cron",
        entityId: `daily_${today}`,
        after: {
          date: today,
          reminded: result.reminded,
          notifiedOnDueDate: result.notifiedOnDueDate,
          markedOverdue: result.markedOverdue,
          suspended: result.suspended,
          errors: result.errors.length
        }
      });
    } catch (error) {
      // CRÍTICO: Liberar lock con status "failed" si el job crashea
      // Esto permite re-intento (el lock no queda muerto)
      await jobLockRepository.release(context.organizationId, today, "daily", "failed");

      result.status = "failed";
      const message = error instanceof Error ? error.message : "Error desconocido";
      result.errors.push(message);
    }

    return result;
  }
};

async function processSubscription(
  context: RequestContext,
  subscription: Subscription,
  today: string,
  result: JobResult
) {
  const periods = await billingPeriodRepository.getBySubscription(
    context.organizationId,
    subscription.id
  );

  const activePeriod = periods.find(
    (period) =>
      period.type === "regular" &&
      (period.status === "pending" ||
        period.status === "partial" ||
        period.status === "overdue")
  );

  if (!activePeriod) {
    return;
  }

  if (
    activePeriod.status === "pending" ||
    activePeriod.status === "partial"
  ) {
    await tryReminder(context, subscription, activePeriod, today, result);
    await tryNotifyOnDueDate(context, subscription, activePeriod, today, result);
  }

  if (activePeriod.status === "pending" || activePeriod.status === "partial") {
    await tryMarkOverdue(context, subscription, activePeriod, today, result);
  }

  const refreshedPeriod = await billingPeriodRepository.getById(context.organizationId, activePeriod.id);
  if (refreshedPeriod && refreshedPeriod.status === "overdue") {
    await trySuspend(context, subscription, refreshedPeriod, today, result);
  }
}

async function tryReminder(
  context: RequestContext,
  subscription: Subscription,
  period: BillingPeriod,
  today: string,
  result: JobResult
) {
  const reminderDate = toDateString(addDays(period.dueDate, -3));

  if (today !== reminderDate) {
    return;
  }

  const alreadySent = await communicationRepository.existsForEvent(
    context.organizationId,
    subscription.id,
    CommunicationType.PaymentReminder,
    period.id
  );

  if (alreadySent) {
    return;
  }

  const client = await clientService.getById(context, subscription.clientId);
  const balance = period.amountUsd - period.paidAmountUsd;

    await notificationService.send({
      context,
      clientId: client.id,
      subscriptionId: subscription.id,
      type: CommunicationType.PaymentReminder,
      to: client.phone,
      templateVariables: {
        "1": client.name,
        "2": period.dueDate
      },
      body: buildReminderMessage(client, subscription, period, balance),
      payload: {
        billingPeriodId: period.id,
        dueDate: period.dueDate,
        balanceUsd: balance
      }
    });

  result.reminded++;
}

async function tryNotifyOnDueDate(
  context: RequestContext,
  subscription: Subscription,
  period: BillingPeriod,
  today: string,
  result: JobResult
) {
  if (today !== period.dueDate) {
    return;
  }

  if (period.paidAmountUsd >= period.amountUsd) {
    return;
  }

  const alreadySent = await communicationRepository.existsForEvent(
    context.organizationId,
    subscription.id,
    CommunicationType.Overdue,
    period.id
  );

  if (alreadySent) {
    return;
  }

  const client = await clientService.getById(context, subscription.clientId);
  const balance = period.amountUsd - period.paidAmountUsd;

  try {
    await notificationService.send({
      context,
      clientId: client.id,
      subscriptionId: subscription.id,
      type: CommunicationType.Overdue,
      to: client.phone,
      templateVariables: {
        "1": client.name,
        "2": subscription.starlinkAccountId,
        "3": today
      },
      body: buildDueDateMessage(client, subscription, period, balance),
      payload: {
        billingPeriodId: period.id,
        dueDate: period.dueDate,
        event: "due_date",
        amountUsd: balance
      }
    });
  } catch {
    // Notification failure should not block state changes
  }

  result.notifiedOnDueDate++;
}

async function tryMarkOverdue(
  context: RequestContext,
  subscription: Subscription,
  period: BillingPeriod,
  today: string,
  result: JobResult
) {
  const dayAfterDue = toDateString(addDays(period.dueDate, 1));

  if (today < dayAfterDue) {
    return;
  }

  await billingService.markOverdue(period);

  const client = await clientService.getById(context, subscription.clientId);

  try {
    await notificationService.send({
      context,
      clientId: client.id,
      subscriptionId: subscription.id,
      type: CommunicationType.Overdue,
      to: client.phone,
      templateVariables: {
        "1": client.name,
        "2": subscription.starlinkAccountId,
        "3": today
      },
      body: buildOverdueMessage(client, subscription, period),
      payload: {
        billingPeriodId: period.id,
        dueDate: period.dueDate,
        event: "overdue",
        amountUsd: period.amountUsd
      }
    });
  } catch {
    // Notification failure should not block state changes
  }

  result.markedOverdue++;
}

async function trySuspend(
  context: RequestContext,
  subscription: Subscription,
  period: BillingPeriod,
  today: string,
  result: JobResult
) {
  const suspensionDate = toDateString(addDays(period.dueDate, subscription.graceDays));

  if (today < suspensionDate) {
    return;
  }

  const lateFee = await billingService.suspendPeriod(period, subscription);

  await subscriptionRepository.update(
    subscription.id,
    subscription.organizationId,
    { status: SubscriptionStatus.Suspended }
  );

  await activityLogService.log({
    context: {
      ...context,
      userId: "cron-daily",
      role: UserRole.Admin
    },
    action: "subscription.suspended_auto",
    entityType: "subscription",
    entityId: subscription.id,
    after: {
      status: SubscriptionStatus.Suspended,
      lateFeeId: lateFee.id,
      suspensionDate: today
    }
  });

  const client = await clientService.getById(context, subscription.clientId);

  try {
    await notificationService.send({
      context,
      clientId: client.id,
      subscriptionId: subscription.id,
      type: CommunicationType.Suspended,
      to: client.phone,
      templateVariables: {
        "1": client.name,
        "2": subscription.starlinkAccountId
      },
      body: buildSuspendedMessage(client, subscription, period, lateFee),
      payload: {
        billingPeriodId: period.id,
        lateFeeId: lateFee.id,
        amountUsd: period.amountUsd,
        lateFeeUsd: lateFee.amountUsd
      }
    });
  } catch {
    // Notification failure should not block state changes
  }

  result.suspended++;
}

function buildReminderMessage(client: Client, subscription: Subscription, period: BillingPeriod, balance: number): string {
  return (
    `Hola ${client.name}, tu suscripción ${subscription.starlinkAccountId} tiene un saldo pendiente de ` +
    `${balance.toFixed(2)} USD con fecha de vencimiento ${period.dueDate}. ` +
    `Si no pagas a tiempo, el servicio podría suspenderse después de ${subscription.graceDays} días.`
  );
}

function buildDueDateMessage(client: Client, subscription: Subscription, period: BillingPeriod, balance: number): string {
  return (
    `${client.name}, hoy ${period.dueDate} vence tu suscripción ${subscription.starlinkAccountId}. ` +
    `Saldo pendiente: ${balance.toFixed(2)} USD. ` +
    `De no pagar, el servicio se suspenderá en ${subscription.graceDays} días.`
  );
}

function buildOverdueMessage(client: Client, subscription: Subscription, period: BillingPeriod): string {
  return (
    `${client.name}, tu suscripción ${subscription.starlinkAccountId} está vencida desde ${period.dueDate}. ` +
    `Debes ${period.amountUsd.toFixed(2)} USD. Tienes ${subscription.graceDays} días antes de la suspensión.`
  );
}

function buildSuspendedMessage(
  client: Client,
  subscription: Subscription,
  period: BillingPeriod,
  lateFee: { amountUsd: number }
): string {
  const total = period.amountUsd - period.paidAmountUsd + lateFee.amountUsd;
  return (
    `${client.name}, tu suscripción ${subscription.starlinkAccountId} ha sido suspendida. ` +
    `Total pendiente: ${total.toFixed(2)} USD (incluye mora de ${lateFee.amountUsd.toFixed(2)} USD). ` +
    `Para reactivar debes pagar el total adeudado más un recargo.`
  );
}
