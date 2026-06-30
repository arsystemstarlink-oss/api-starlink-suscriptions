import {
  paymentRepository,
  billingPeriodRepository,
  subscriptionRepository,
  runFirestoreTransaction,
} from "../../infrastructure/firestore/repositories.js";
import { BusinessRuleError, NotFoundError } from "../../domain/errors.js";
import {
  BillingPeriodStatus,
  BillingPeriodType,
  CommunicationType,
  PaymentStatus,
  SubscriptionStatus,
  UserRole,
} from "../../domain/types.js";
import type {
  BillingPeriod,
  Payment,
  RequestContext,
  Subscription,
} from "../../domain/models.js";
import {
  calculateAdvanceCharge,
  roundMoney,
} from "../../domain/calculations.js";
import {
  addMonthsPreservingDay,
  daysUntilNextCutoff,
  nextCutoffDate,
  toDateString,
  toLocalDate,
} from "../../domain/dateUtils.js";
import { paymentService } from "../payments/paymentService.js";
import { activityLogService } from "../audit/activityLogService.js";
import { notificationService } from "../notifications/notificationService.js";
import { clientService } from "../clients/clientService.js";

/**
 * Servicio especializado en el flujo de reactivación de suscripciones.
 *
 * Separación de responsabilidades:
 * - `paymentService` se enfoca en el ciclo de vida de los pagos (register/confirm/void)
 *   y en consulta de deuda.
 * - `reactivationService` se enfoca en la orquestación de la reactivación de una
 *   suscripción suspendida: cálculo del quote, validación de pagos, y ejecución
 *   transaccional de la reactivación.
 *
 * Reglas de negocio:
 * - Solo se reactivan suscripciones con status = Suspended.
 * - El total pagado (suma de `amountUsd` de los pagos confirmados) debe cubrir
 *   exactamente el total calculado por `calculateReactivationQuote`.
 * - Todos los pagos referenciados deben estar en status = Confirmed.
 * - La operación es transaccional (Firestore): crea períodos de adelanto y
 *   regular, marca el período suspendido como pagado y actualiza la suscripción
 *   a Active en una sola transacción.
 */
export const reactivationService = {
  /**
   * Calcula el quote de reactivación para una suscripción suspendida.
   *
   * Incluye: deuda vencida, mora, período de adelanto (prorrata) y recargo 5%.
   *
   * @throws NotFoundError si la suscripción no existe.
   */
  async calculateReactivationQuote(context: RequestContext, subscriptionId: string) {
    const subscription = await subscriptionRepository.getById(context.organizationId, subscriptionId);

    if (!subscription) {
      throw new NotFoundError(`Suscripción no encontrada (id: ${subscriptionId})`);
    }

    if (subscription.status !== SubscriptionStatus.Suspended) {
      return {
        canReactivate: false,
        requiredUsd: 0,
        breakdown: {
          overdueAmountUsd: 0,
          lateFeeUsd: 0,
          advanceAmountUsd: 0,
          surchargeUsd: 0,
        },
        nextCutoffDate: null,
      };
    }

    const debt = await paymentService.calculateDebt(context, subscriptionId);
    const overdueAmountUsd = roundMoney(
      debt.overduePeriods.reduce((sum, p) => sum + p.balanceUsd, 0),
    );
    const lateFeeUsd = roundMoney(
      debt.overduePeriods.reduce((sum, p) => sum + p.lateFeeUsd, 0),
    );

    const advance = debt.advance ?? { days: 0, amountUsd: 0, surchargeUsd: 0, totalUsd: 0 };
    const requiredUsd = roundMoney(overdueAmountUsd + lateFeeUsd + advance.totalUsd);

    return {
      canReactivate: true,
      requiredUsd,
      breakdown: {
        overdueAmountUsd,
        lateFeeUsd,
        advanceAmountUsd: advance.amountUsd,
        surchargeUsd: advance.surchargeUsd,
      },
      nextCutoffDate:
        advance.days > 0
          ? toDateString(nextCutoffDate(new Date(), subscription.dueDay))
          : null,
    };
  },

  /**
   * Ejecuta la reactivación de una suscripción suspendida.
   *
   * Es una operación transaccional que:
   * 1. Valida que la suscripción esté suspendida.
   * 2. Valida que los pagos cubran exactamente el total requerido.
   * 3. Valida que todos los pagos estén confirmados.
   * 4. En una sola transacción de Firestore:
   *    - Marca el período suspendido como pagado.
   *    - Crea el período de adelanto (prorrata) si aplica.
   *    - Crea el siguiente período regular.
   *    - Cambia la suscripción a Active.
   * 5. Notifica al cliente por WhatsApp.
   * 6. Registra en el ActivityLog.
   *
   * @throws NotFoundError si la suscripción o el período principal no existen.
   * @throws BusinessRuleError si la suscripción no está suspendida, los pagos no
   *         están confirmados, o el total no coincide con el quote.
   */
  async reactivate(input: {
    context: RequestContext;
    subscriptionId: string;
    paymentIds: string[];
    expectedTotalUsd: number;
  }) {
    const subscription = await subscriptionRepository.getById(
      input.context.organizationId,
      input.subscriptionId,
    );

    if (!subscription) {
      throw new NotFoundError(`Suscripción no encontrada (id: ${input.subscriptionId})`);
    }

    if (subscription.status !== SubscriptionStatus.Suspended) {
      throw new BusinessRuleError("Solo se pueden reactivar suscripciones suspendidas");
    }

    const quote = await this.calculateReactivationQuote(input.context, subscription.id);

    if (!quote.canReactivate || roundMoney(input.expectedTotalUsd) !== quote.requiredUsd) {
      throw new BusinessRuleError("El total de reactivación no coincide con la deuda calculada");
    }

    const payments: Payment[] = [];

    for (const paymentId of input.paymentIds) {
      const payment = await paymentRepository.getById(input.context.organizationId, paymentId);

      if (!payment || payment.status !== PaymentStatus.Confirmed) {
        throw new BusinessRuleError("Todos los pagos deben estar confirmados");
      }

      payments.push(payment);
    }

    const paidUsd = roundMoney(
      payments.reduce((total, payment) => total + payment.amountUsd, 0),
    );

    if (paidUsd < quote.requiredUsd) {
      throw new BusinessRuleError("El pago no cubre el total requerido para reactivar");
    }

    const mainPeriod = await this.findReactivationPeriod(input.context, subscription.id);

    if (!mainPeriod) {
      throw new NotFoundError(
        `Período principal para reactivar no encontrado (subscriptionId: ${subscription.id})`,
      );
    }

    const advance = calculateAdvanceCharge(
      subscription.priceUsd,
      daysUntilNextCutoff(new Date(), subscription.dueDay),
    );

    const reactivatedAt = new Date().toISOString();
    let advancePeriod: BillingPeriod | null = null;
    let nextPeriod: BillingPeriod | null = null;

    // Transacción: operaciones atómicas de reactivación
    await runFirestoreTransaction(async (transaction) => {
      if (mainPeriod.status !== BillingPeriodStatus.Paid) {
        const mainPeriodRef = billingPeriodRepository.getRef(
          mainPeriod.organizationId,
          mainPeriod.id,
        );
        transaction.update(mainPeriodRef, {
          paidAmountUsd: mainPeriod.amountUsd,
          status: BillingPeriodStatus.Paid,
          updatedAt: reactivatedAt,
        });
      }

      if (advance.days > 0) {
        const advanceId = crypto.randomUUID();
        const advanceRef = billingPeriodRepository.getRef(subscription.organizationId, advanceId);

        advancePeriod = {
          id: advanceId,
          organizationId: subscription.organizationId,
          subscriptionId: subscription.id,
          clientId: subscription.clientId,
          type: BillingPeriodType.Advance,
          startDate: toDateString(new Date()),
          endDate: toDateString(nextCutoffDate(new Date(), subscription.dueDay)),
          dueDate: toDateString(nextCutoffDate(new Date(), subscription.dueDay)),
          status: BillingPeriodStatus.Paid,
          amountUsd: advance.amountUsd,
          paidAmountUsd: advance.amountUsd,
          surchargeUsd: advance.surchargeUsd,
          createdAt: reactivatedAt,
          updatedAt: reactivatedAt,
        };

        transaction.create(advanceRef, advancePeriod);
      }

      const previousDueDate = quote.nextCutoffDate ?? new Date();
      const startDate = toLocalDate(previousDueDate);
      const nextDueDate = addMonthsPreservingDay(startDate, 1);
      const nextId = crypto.randomUUID();
      const nextRef = billingPeriodRepository.getRef(subscription.organizationId, nextId);

      nextPeriod = {
        id: nextId,
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        clientId: subscription.clientId,
        type: BillingPeriodType.Regular,
        startDate: toDateString(startDate),
        dueDate: toDateString(nextDueDate),
        status: BillingPeriodStatus.Pending,
        amountUsd: subscription.priceUsd,
        paidAmountUsd: 0,
        surchargeUsd: 0,
        createdAt: reactivatedAt,
        updatedAt: reactivatedAt,
      };

      transaction.create(nextRef, nextPeriod);

      const subscriptionRef = subscriptionRepository.getRef(
        subscription.organizationId,
        subscription.id,
      );
      transaction.update(subscriptionRef, {
        status: SubscriptionStatus.Active,
        updatedAt: reactivatedAt,
      });
    });

    const reactivatedSubscription: Subscription = {
      ...subscription,
      status: SubscriptionStatus.Active,
      updatedAt: reactivatedAt,
    };

    await activityLogService.log({
      context: input.context,
      action: "subscription.reactivated",
      entityType: "subscription",
      entityId: subscription.id,
      after: {
        subscription: reactivatedSubscription as unknown as Record<string, unknown>,
        payments: payments.map((p) => p.id),
        advancePeriod: advancePeriod as unknown as Record<string, unknown>,
        nextPeriod: nextPeriod as unknown as Record<string, unknown>,
      },
    });

    await sendReactivationNotification(input.context, reactivatedSubscription, payments[0]);

    return {
      subscription: reactivatedSubscription,
      quote,
      paidUsd,
      advancePeriod,
      nextPeriod,
    };
  },

  /**
   * Encuentra el período principal sobre el cual se aplicará la reactivación.
   * Debe estar en estado suspendido, overdue, partial o pending.
   */
  async findReactivationPeriod(context: RequestContext, subscriptionId: string) {
    const periods = await billingPeriodRepository.getBySubscription(
      context.organizationId,
      subscriptionId,
    );

    return (
      periods.find(
        (period) =>
          period.type === BillingPeriodType.Regular &&
          [
            BillingPeriodStatus.Suspended,
            BillingPeriodStatus.Overdue,
            BillingPeriodStatus.Partial,
            BillingPeriodStatus.Pending,
          ].includes(period.status),
      ) ?? null
    );
  },
};

/**
 * Envía notificación de reactivación por WhatsApp.
 * No bloquea ante fallo (solo lo registra en consola).
 */
async function sendReactivationNotification(
  context: RequestContext,
  subscription: Subscription,
  payment: Payment,
): Promise<void> {
  try {
    const client = await clientService.getById(context, subscription.clientId);

    await notificationService.send({
      context,
      clientId: client.id,
      subscriptionId: subscription.id,
      type: CommunicationType.PaymentConfirmed,
      to: client.phone,
      body:
        `${client.name}, tu suscripción ${subscription.starlinkAccountId} ha sido reactivada. ` +
        `Pago confirmado por ${payment.amountUsd.toFixed(2)} USD (ref: ${payment.reference}). ¡Gracias!`,
      payload: {
        paymentId: payment.id,
        amountUsd: payment.amountUsd,
        reference: payment.reference,
        confirmedAt: payment.confirmedAt ?? new Date().toISOString(),
        event: "subscription.reactivated",
      },
    });
  } catch (error) {
    console.error("Error enviando notificación de reactivación:", error);
  }
}
