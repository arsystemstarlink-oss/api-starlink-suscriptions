import {
  FieldValue,
  paymentRepository,
  billingPeriodRepository,
  subscriptionRepository,
  lateFeeRepository,
  runFirestoreTransaction
} from "../../infrastructure/firestore/repositories.js";
import { BusinessRuleError, NotFoundError } from "../../domain/errors.js";
import {
  BillingPeriodStatus,
  BillingPeriodType,
  CommunicationType,
  PaymentStatus,
  SubscriptionStatus,
  UserRole
} from "../../domain/types.js";
import type { BillingPeriod, Payment, RequestContext, Subscription } from "../../domain/models.js";
import { calculateAdvanceCharge, roundMoney } from "../../domain/calculations.js";
import { daysUntilNextCutoff } from "../../domain/dateUtils.js";
import { billingService } from "../billing/billingService.js";
import { activityLogService } from "../audit/activityLogService.js";
import { notificationService } from "../notifications/notificationService.js";
import { clientService } from "../clients/clientService.js";

/**
 * Servicio encargado del ciclo de vida de los pagos.
 *
 * Responsabilidades:
 * - Registrar pagos (status = Registered).
 * - Confirmar pagos (Registered → Confirmed), actualizando el billingPeriod.
 * - Anular pagos (Confirmed/Registered → Voided), recalculando el billingPeriod.
 * - Calcular deuda de una suscripción (consulta, no modifica estado).
 * - Crear el siguiente período regular cuando un pago regular completa su billingPeriod.
 *
 * Responsabilidades de otros servicios:
 * - Reactivación de suscripciones → `reactivationService`.
 */
export const paymentService = {
  async register(input: {
    context: RequestContext;
    billingPeriodId: string;
    amount: number;
    currency: Payment["currency"];
    exchangeRate: number;
    reference: string;
    proofImage: string;
    paidAt?: string;
  }) {
    const period = await billingPeriodRepository.getById(input.context.organizationId, input.billingPeriodId);

    if (!period) {
      throw new NotFoundError(`Período de facturación no encontrado (id: ${input.billingPeriodId})`);
    }

    if (period.status === BillingPeriodStatus.Paid) {
      throw new BusinessRuleError("No se permiten pagos sobre períodos ya pagados");
    }

    const existing = await paymentRepository.getByReference(
      input.context.organizationId,
      input.reference
    );

    if (existing) {
      throw new BusinessRuleError("Ya existe un pago confirmado con esa referencia");
    }

    const amountUsd = roundMoney(input.amount * input.exchangeRate);

    const payment = await paymentRepository.create({
      organizationId: input.context.organizationId,
      billingPeriodId: period.id,
      subscriptionId: period.subscriptionId,
      clientId: period.clientId,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      amountUsd,
      reference: input.reference,
      proofImage: input.proofImage,
      paidAt: input.paidAt ?? new Date().toISOString(),
      createdBy: input.context.userId,
      status: PaymentStatus.Registered
    });

    await activityLogService.log({
      context: input.context,
      action: "payment.registered",
      entityType: "payment",
      entityId: payment.id,
      after: {
        paymentId: payment.id,
        billingPeriodId: period.id,
        amountUsd: payment.amountUsd,
        currency: payment.currency,
        reference: payment.reference,
        status: PaymentStatus.Registered
      } as unknown as Record<string, unknown>
    });

    return payment;
  },

  async listByClient(context: RequestContext, clientId: string): Promise<Payment[]> {
    return paymentRepository.listByClientId(context.organizationId, clientId, "desc");
  },

  async confirm(context: RequestContext, paymentId: string) {
    const payment = await paymentRepository.getById(context.organizationId, paymentId);

    if (!payment) {
      throw new NotFoundError(`Pago no encontrado (id: ${paymentId})`);
    }

    if (payment.status === PaymentStatus.Confirmed) {
      return payment;
    }

    if (payment.status === PaymentStatus.Voided) {
      throw new BusinessRuleError("No se puede confirmar un pago anulado");
    }

    const period = await billingPeriodRepository.getById(payment.organizationId, payment.billingPeriodId);
    const subscription = await subscriptionRepository.getById(payment.organizationId, payment.subscriptionId);

    if (!period || !subscription) {
      throw new NotFoundError(
        `Pago hace referencia a documentos inexistentes (periodId: ${payment.billingPeriodId}, subscriptionId: ${payment.subscriptionId})`
      );
    }

    if (period.status === BillingPeriodStatus.Paid && period.type === BillingPeriodType.Regular) {
      throw new BusinessRuleError("No se permiten pagos sobre períodos regulares ya pagados");
    }

    const confirmedAt = new Date().toISOString();
    const nextPeriodStatus = calculateNextPeriodStatus(period, payment.amountUsd);

    await runFirestoreTransaction(async (transaction) => {
      const paymentRef = paymentRepository.getRef(payment.organizationId, payment.id);
      const periodRef = billingPeriodRepository.getRef(payment.organizationId, period.id);

      transaction.update(paymentRef, {
        status: PaymentStatus.Confirmed,
        confirmedAt,
        confirmedBy: context.userId,
        updatedAt: confirmedAt
      });

      transaction.update(periodRef, {
        paidAmountUsd: FieldValue.increment(payment.amountUsd),
        status: nextPeriodStatus,
        updatedAt: confirmedAt
      });
    });

    const updatedPeriod: BillingPeriod = {
      ...period,
      paidAmountUsd: roundMoney(period.paidAmountUsd + payment.amountUsd),
      status: nextPeriodStatus
    };

    await activityLogService.log({
      context: {
        organizationId: payment.organizationId,
        userId: context.userId,
        role: UserRole.Admin
      },
      action: "payment.confirmed",
      entityType: "payment",
      entityId: payment.id,
      after: {
        payment: { ...payment, status: PaymentStatus.Confirmed, confirmedAt } as unknown as Record<string, unknown>,
        billingPeriod: updatedPeriod as unknown as Record<string, unknown>
      }
    });

    if (nextPeriodStatus === BillingPeriodStatus.Paid) {
      await this.handlePaidPeriod(payment.organizationId, updatedPeriod, subscription);
    }

    const confirmedPayment = { ...payment, status: PaymentStatus.Confirmed, confirmedAt };

    await sendPaymentConfirmedNotification(context, subscription, confirmedPayment);

    return confirmedPayment;
  },

  /**
   * Anula un pago previamente registrado o confirmado.
   *
   * CRÍTICO - Operación transaccional:
   * Ambas (void del payment + recálculo del billingPeriod) deben ocurrir
   * en la misma transacción para evitar race conditions con confirmaciones
   * concurrentes del mismo billingPeriod.
   */
  async void(context: RequestContext, input: { paymentId: string; reason: string }) {
    const payment = await paymentRepository.getById(context.organizationId, input.paymentId);

    if (!payment) {
      throw new NotFoundError(`Pago no encontrado (id: ${input.paymentId})`);
    }

    if (payment.status === PaymentStatus.Voided) {
      return payment;
    }

    const period = await billingPeriodRepository.getById(payment.organizationId, payment.billingPeriodId);

    if (!period) {
      throw new NotFoundError(`Período de facturación no encontrado (id: ${payment.billingPeriodId})`);
    }

    const voidedAt = new Date().toISOString();

    await runFirestoreTransaction(async (transaction) => {
      const paymentRef = paymentRepository.getRef(payment.organizationId, payment.id);
      transaction.update(paymentRef, {
        status: PaymentStatus.Voided,
        voidedAt,
        voidReason: input.reason,
        voidedBy: context.userId,
        updatedAt: voidedAt
      });

      const confirmedPayments = (await paymentRepository.listByBillingPeriod(
        payment.organizationId,
        payment.billingPeriodId
      )).filter((item) => item.status === PaymentStatus.Confirmed && item.id !== payment.id);

      const paidAmountUsd = roundMoney(
        confirmedPayments.reduce((total, item) => total + item.amountUsd, 0)
      );

      const periodRef = billingPeriodRepository.getRef(period.organizationId, period.id);
      transaction.update(periodRef, {
        paidAmountUsd,
        status: calculateStatusFromPaidAmount(period, paidAmountUsd),
        updatedAt: voidedAt
      });
    });

    const updatedPayment = await paymentRepository.getById(context.organizationId, input.paymentId);
    const updatedPeriod = await billingPeriodRepository.getById(context.organizationId, period.id);

    await activityLogService.log({
      context: {
        organizationId: context.organizationId,
        userId: context.userId,
        role: UserRole.Admin
      },
      action: "payment.voided",
      entityType: "payment",
      entityId: payment.id,
      reason: input.reason,
      after: {
        payment: updatedPayment as unknown as Record<string, unknown>,
        billingPeriod: updatedPeriod as unknown as Record<string, unknown>
      }
    });

    return { ...payment, status: PaymentStatus.Voided, voidedAt };
  },

  /**
   * Calcula la deuda de una suscripción, incluyendo:
   * - Períodos vencidos (balance + mora).
   * - Período de adelanto (prorrata) si la suscripción está suspendida.
   */
  async calculateDebt(context: RequestContext, subscriptionId: string) {
    const subscription = await subscriptionRepository.getById(context.organizationId, subscriptionId);

    if (!subscription) {
      throw new NotFoundError(`Suscripción no encontrada (id: ${subscriptionId})`);
    }

    const periods = await billingPeriodRepository.getBySubscription(
      context.organizationId,
      subscriptionId
    );

    const overduePeriods: Array<{
      billingPeriodId: string;
      startDate: string;
      dueDate: string;
      amountUsd: number;
      paidAmountUsd: number;
      balanceUsd: number;
      lateFeeUsd: number;
    }> = [];
    let totalPureDebt = 0;
    let totalLateFees = 0;

    for (const period of periods) {
      if (period.status === BillingPeriodStatus.Paid) {
        continue;
      }

      const fee = await getAppliedLateFee(context.organizationId, period.id);
      const balanceUsd = roundMoney(period.amountUsd - period.paidAmountUsd);

      if (balanceUsd <= 0 && fee <= 0) {
        continue;
      }

      totalPureDebt = roundMoney(totalPureDebt + Math.max(0, balanceUsd));
      totalLateFees = roundMoney(totalLateFees + fee);

      overduePeriods.push({
        billingPeriodId: period.id,
        startDate: period.startDate,
        dueDate: period.dueDate,
        amountUsd: period.amountUsd,
        paidAmountUsd: period.paidAmountUsd,
        balanceUsd: Math.max(0, balanceUsd),
        lateFeeUsd: fee
      });
    }

    let advance: {
      days: number;
      amountUsd: number;
      surchargeUsd: number;
      totalUsd: number;
    } | null = null;

    if (subscription.status === SubscriptionStatus.Suspended) {
      const daysUntilCutoffValue = daysUntilNextCutoff(new Date(), subscription.dueDay);
      const advanceCharge = calculateAdvanceCharge(subscription.priceUsd, daysUntilCutoffValue);
      advance = {
        days: advanceCharge.days,
        amountUsd: advanceCharge.amountUsd,
        surchargeUsd: advanceCharge.surchargeUsd,
        totalUsd: advanceCharge.totalUsd
      };
    }

    const advanceTotal = advance ? advance.totalUsd : 0;
    const totalDueUsd = roundMoney(totalPureDebt + totalLateFees + advanceTotal);

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      overduePeriods,
      advance,
      totalDueUsd
    };
  },

  /**
   * Cuando un billingPeriod regular queda completo, se encarga de:
   * - Reactivar la suscripción si estaba Pausada.
   * - Crear el siguiente período regular.
   */
  async handlePaidPeriod(
    organizationId: string,
    period: BillingPeriod,
    subscription: Subscription
  ) {
    if (subscription.status === SubscriptionStatus.Paused) {
      await subscriptionRepository.update(subscription.id, subscription.organizationId, {
        status: SubscriptionStatus.Active
      });
    }

    if (period.type === BillingPeriodType.Regular && subscription.status !== SubscriptionStatus.Suspended) {
      await billingService.createNextRegularPeriod({
        context: {
          organizationId,
          userId: "payment-service",
          role: UserRole.Admin
        },
        subscription,
        previousDueDate: period.dueDate
      });
    }
  }
};

async function getAppliedLateFee(organizationId: string, billingPeriodId: string): Promise<number> {
  const lateFee = await lateFeeRepository.getByBillingPeriod(organizationId, billingPeriodId);
  return lateFee?.amountUsd ?? 0;
}

async function sendPaymentConfirmedNotification(
  context: RequestContext,
  subscription: Subscription,
  payment: Payment
): Promise<void> {
  try {
    const client = await clientService.getById(context, subscription.clientId);

    await notificationService.send({
      context,
      clientId: client.id,
      subscriptionId: subscription.id,
      type: CommunicationType.PaymentConfirmed,
      to: client.phone,
      body: (
        `${client.name}, tu pago de ${payment.amountUsd.toFixed(2)} USD (ref: ${payment.reference}) ` +
        `para la suscripción ${subscription.starlinkAccountId} ha sido confirmado. ¡Gracias!`
      ),
      payload: {
        paymentId: payment.id,
        amountUsd: payment.amountUsd,
        reference: payment.reference,
        confirmedAt: payment.confirmedAt ?? new Date().toISOString()
      }
    });
  } catch {
    // Notification failure does not affect the payment or subscription state
  }
}

function calculateNextPeriodStatus(period: BillingPeriod, paymentAmountUsd: number): BillingPeriodStatus {
  const paidAmountUsd = roundMoney(period.paidAmountUsd + paymentAmountUsd);

  if (paidAmountUsd >= period.amountUsd) {
    return BillingPeriodStatus.Paid;
  }

  if (paidAmountUsd > 0) {
    return BillingPeriodStatus.Partial;
  }

  return period.status;
}

function calculateStatusFromPaidAmount(period: BillingPeriod, paidAmountUsd: number): BillingPeriodStatus {
  if (paidAmountUsd >= period.amountUsd) {
    return BillingPeriodStatus.Paid;
  }

  if (paidAmountUsd > 0) {
    return BillingPeriodStatus.Partial;
  }

  return period.status;
}
