import {
  billingPeriodRepository,
  lateFeeRepository,
  runFirestoreTransaction
} from "../../infrastructure/firestore/repositories.js";
import {
  BillingPeriodStatus,
  BillingPeriodType,
  SubscriptionStatus,
  UserRole
} from "../../domain/types.js";
import type { BillingPeriod, LateFee, Subscription } from "../../domain/models.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { addMonthsPreservingDay, toDateString, toLocalDate } from "../../domain/dateUtils.js";
import { activityLogService } from "../audit/activityLogService.js";
import type { RequestContext } from "../../domain/models.js";

export const billingService = {
  async createInitialRegularPeriod(input: {
    context: RequestContext;
    subscription: Subscription;
    startDate: Date | string;
    dueDate: Date | string;
  }) {
    return billingPeriodRepository.create({
      organizationId: input.context.organizationId,
      subscriptionId: input.subscription.id,
      clientId: input.subscription.clientId,
      type: BillingPeriodType.Regular,
      startDate: toDateString(input.startDate),
      dueDate: toDateString(input.dueDate),
      status: BillingPeriodStatus.Pending,
      amountUsd: input.subscription.priceUsd,
      paidAmountUsd: 0,
      surchargeUsd: 0
    });
  },

  async createNextRegularPeriod(input: {
    context: RequestContext;
    subscription: Subscription;
    previousDueDate: Date | string;
  }) {
    const startDate = toLocalDate(input.previousDueDate);
    const dueDate = addMonthsPreservingDay(startDate, 1);

    return billingPeriodRepository.create({
      organizationId: input.context.organizationId,
      subscriptionId: input.subscription.id,
      clientId: input.subscription.clientId,
      type: BillingPeriodType.Regular,
      startDate: toDateString(startDate),
      dueDate: toDateString(dueDate),
      status: BillingPeriodStatus.Pending,
      amountUsd: input.subscription.priceUsd,
      paidAmountUsd: 0,
      surchargeUsd: 0
    });
  },

  async createAdvancePeriod(input: {
    context: RequestContext;
    subscription: Subscription;
    startDate: Date | string;
    endDate: Date | string;
    amountUsd: number;
    surchargeUsd: number;
  }) {
    return billingPeriodRepository.create({
      organizationId: input.context.organizationId,
      subscriptionId: input.subscription.id,
      clientId: input.subscription.clientId,
      type: BillingPeriodType.Advance,
      startDate: toDateString(input.startDate),
      endDate: toDateString(input.endDate),
      dueDate: toDateString(input.endDate),
      status: BillingPeriodStatus.Paid,
      amountUsd: input.amountUsd,
      paidAmountUsd: input.amountUsd,
      surchargeUsd: input.surchargeUsd
    });
  },

  async markOverdue(period: BillingPeriod) {
    await billingPeriodRepository.update(
      period.id,
      period.organizationId,
      { status: BillingPeriodStatus.Overdue }
    );

    await activityLogService.log({
      context: {
        organizationId: period.organizationId,
        userId: "cron-daily",
        role: UserRole.Admin
      },
      action: "billing_period.overdue",
      entityType: "billingPeriod",
      entityId: period.id,
      before: { status: period.status },
      after: { status: BillingPeriodStatus.Overdue }
    });
  },

  /**
   * Suspende un período de facturación y crea la mora correspondiente.
   *
   * CRÍTICO: Ambas operaciones (crear LateFee + actualizar BillingPeriod) deben ser atómicas.
   * Si falla entre ambas, quedarían inconsistentes (LateFee sin BillingPeriod suspendido,
   * o BillingPeriod suspendido sin LateFee).
   */
  async suspendPeriod(period: BillingPeriod, subscription: Subscription): Promise<LateFee> {
    const existingLateFee = await lateFeeRepository.getByBillingPeriod(
      period.organizationId,
      period.id
    );

    let lateFee: LateFee | null = existingLateFee;

    if (!lateFee) {
      // Crear LateFee en una sola transacción con la actualización del periodo
      const now = new Date().toISOString();
      const lateFeeId = crypto.randomUUID();
      
      await runFirestoreTransaction(async (transaction) => {
        // 1. Crear LateFee
        const lateFeeRef = lateFeeRepository.getRef(
          period.organizationId,
          lateFeeId
        );
        
        lateFee = {
          id: lateFeeId,
          organizationId: period.organizationId,
          billingPeriodId: period.id,
          subscriptionId: subscription.id,
          amountUsd: subscription.lateFeeUsd,
          status: "applied",
          createdAt: now,
          appliedAt: now
        };
        
        transaction.create(lateFeeRef, lateFee);
        
        // 2. Actualizar billingPeriod a suspended
        const periodRef = billingPeriodRepository.getRef(
          period.organizationId,
          period.id
        );
        
        transaction.update(periodRef, {
          status: BillingPeriodStatus.Suspended,
          suspensionDate: toDateString(new Date()),
          updatedAt: now
        });
      });
    } else {
      // LateFee ya existe, solo actualizar el periodo
      await billingPeriodRepository.update(
        period.id,
        period.organizationId,
        {
          status: BillingPeriodStatus.Suspended,
          suspensionDate: toDateString(new Date())
        }
      );
    }

    await activityLogService.log({
      context: {
        organizationId: period.organizationId,
        userId: "cron-daily",
        role: UserRole.Admin
      },
      action: "billing_period.suspended",
      entityType: "billingPeriod",
      entityId: period.id,
      before: { status: period.status },
      after: { status: BillingPeriodStatus.Suspended, lateFeeId: (lateFee as LateFee).id }
    });

    return lateFee as LateFee;
  },

  async assertSingleActivePeriod(input: {
    context: RequestContext;
    subscriptionId: string;
    excludingPeriodId?: string;
  }) {
    const periods = await billingPeriodRepository.getBySubscription(
      input.context.organizationId,
      input.subscriptionId
    );

    const active = periods.find(
      (period) =>
        period.id !== input.excludingPeriodId &&
        [
          BillingPeriodStatus.Pending,
          BillingPeriodStatus.Partial,
          BillingPeriodStatus.Overdue
        ].includes(period.status)
    );

    if (active) {
      throw new BusinessRuleError("Ya existe un período activo para esta suscripción");
    }
  },

  async recalculatePeriodStatus(period: BillingPeriod) {
    if (period.status === BillingPeriodStatus.Paid || period.status === BillingPeriodStatus.Suspended) {
      return period;
    }

    const nextStatus =
      period.paidAmountUsd <= 0
        ? BillingPeriodStatus.Pending
        : period.paidAmountUsd >= period.amountUsd
          ? BillingPeriodStatus.Paid
          : BillingPeriodStatus.Partial;

    if (nextStatus !== period.status) {
      await billingPeriodRepository.update(period.id, period.organizationId, {
        status: nextStatus
      });
    }

    return { ...period, status: nextStatus };
  },

  async closeSubscriptionIfCancelled(subscription: Subscription) {
    if (subscription.status !== SubscriptionStatus.Cancelled) {
      return;
    }

    const periods = await billingPeriodRepository.getBySubscription(
      subscription.organizationId,
      subscription.id
    );

    const hasPending = periods.some(
      (period) =>
        period.status === BillingPeriodStatus.Pending ||
        period.status === BillingPeriodStatus.Partial ||
        period.status === BillingPeriodStatus.Overdue
    );

    if (hasPending) {
      throw new BusinessRuleError("No se puede cancelar una suscripción con deuda pendiente");
    }
  }
};
