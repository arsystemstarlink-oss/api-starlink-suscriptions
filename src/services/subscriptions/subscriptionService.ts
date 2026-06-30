import { subscriptionRepository, billingPeriodRepository, planRepository, clientRepository } from "../../infrastructure/firestore/repositories.js";
import { BusinessRuleError, NotFoundError } from "../../domain/errors.js";
import { BillingPeriodStatus, CommunicationType, SubscriptionStatus, UserRole } from "../../domain/types.js";
import type { BillingPeriod, Client, RequestContext, Subscription } from "../../domain/models.js";
import { clientService } from "../clients/clientService.js";
import { billingService } from "../billing/billingService.js";
import { activityLogService } from "../audit/activityLogService.js";
import { notificationService } from "../notifications/notificationService.js";
import { nextCutoffDate, toDateString, daysUntilNextCutoff } from "../../domain/dateUtils.js";
import { paymentService } from "../payments/paymentService.js";

export const subscriptionService = {
  async create(input: {
    context: RequestContext;
    clientId: string;
    starlinkAccountId: string;
    kitId: string;
    planId: string;
    dueDay: number;
    starlinkEmail: string;
    starlinkPassword: string;
  }) {
    const existing = await subscriptionRepository.getByStarlinkAccountId(input.context.organizationId, input.starlinkAccountId);
    if (existing) {
      throw new BusinessRuleError("Ya existe una suscripción con ese Starlink Account ID");
    }

    const plan = await planRepository.getById(input.context.organizationId, input.planId);
    if (!plan) {
      throw new NotFoundError(`Plan no encontrado (id: ${input.planId})`);
    }
    if (!plan.isActive) {
      throw new BusinessRuleError("No se puede asociar una suscripción a un plan inactivo");
    }

    const client = await clientService.getById(input.context, input.clientId);
    const startDate = new Date();
    const dueDate = nextCutoffDate(startDate, input.dueDay);

    const subscription = await subscriptionRepository.create({
      organizationId: input.context.organizationId,
      starlinkAccountId: input.starlinkAccountId,
      kitId: input.kitId,
      planId: plan.id,
      planName: plan.name,
      clientId: input.clientId,
      priceUsd: plan.priceUsd,
      status: SubscriptionStatus.Paused,
      dueDay: input.dueDay,
      graceDays: plan.graceDays,
      lateFeeUsd: plan.lateFeeUsd,
      currentOwnerName: client.name,
      currentOwnerDni: client.dni ?? "",
      starlinkEmail: input.starlinkEmail,
      starlinkPassword: input.starlinkPassword
    });

    let billingPeriod: BillingPeriod;

    try {
      billingPeriod = await billingService.createInitialRegularPeriod({
        context: input.context,
        subscription,
        startDate,
        dueDate
      });
    } catch (error) {
      await subscriptionRepository.update(
        subscription.id,
        subscription.organizationId,
        { status: SubscriptionStatus.Cancelled }
      );
      throw error;
    }

    await activityLogService.log({
      context: input.context,
      action: "subscription.created",
      entityType: "subscription",
      entityId: subscription.id,
      after: {
        subscription: subscription as unknown as Record<string, unknown>,
        billingPeriod: billingPeriod as unknown as Record<string, unknown>
      }
    });

    return {
      subscription,
      billingPeriod
    };
  },

  async getById(context: RequestContext, id: string): Promise<Subscription> {
    const subscription = await subscriptionRepository.getById(context.organizationId, id);

    if (!subscription) {
      throw new NotFoundError(`Suscripción no encontrada (id: ${id})`);
    }

    return subscription;
  },

  async listByClient(context: RequestContext, clientId: string): Promise<Subscription[]> {
    return subscriptionRepository.listByClientId(context.organizationId, clientId);
  },

  async transfer(input: {
    context: RequestContext;
    subscriptionId: string;
    newClientId: string;
    currentOwnerName: string;
    currentOwnerDni: string;
    reason: string;
  }) {
    const subscription = await this.getById(input.context, input.subscriptionId);
    await clientService.getById(input.context, input.newClientId);

    const before = { ...subscription };
    const updated: Subscription = {
      ...subscription,
      clientId: input.newClientId,
      currentOwnerName: input.currentOwnerName,
      currentOwnerDni: input.currentOwnerDni,
      updatedAt: new Date().toISOString()
    };

    await subscriptionRepository.update(
      subscription.id,
      subscription.organizationId,
      {
        clientId: input.newClientId,
        currentOwnerName: input.currentOwnerName,
        currentOwnerDni: input.currentOwnerDni
      }
    );

    await activityLogService.log({
      context: input.context,
      action: "subscription.transferred",
      entityType: "subscription",
      entityId: subscription.id,
      reason: input.reason,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>
    });

    return updated;
  },

  async suspendManual(input: {
    context: RequestContext;
    subscriptionId: string;
    reason: string;
  }) {
    const subscription = await this.getById(input.context, input.subscriptionId);

    if (subscription.status === SubscriptionStatus.Suspended) {
      throw new BusinessRuleError("La suscripción ya está suspendida");
    }

    if (subscription.status === SubscriptionStatus.Cancelled) {
      throw new BusinessRuleError("No se puede suspender una suscripción cancelada");
    }

    const before = { ...subscription };

    const activePeriod = await billingPeriodRepository.getActiveRegular(
      input.context.organizationId,
      input.subscriptionId
    );

    if (activePeriod && activePeriod.paidAmountUsd < activePeriod.amountUsd) {
      await billingService.suspendPeriod(activePeriod, subscription);
    }

    await subscriptionRepository.update(
      subscription.id,
      subscription.organizationId,
      { status: SubscriptionStatus.Suspended }
    );

    const updated: Subscription = {
      ...subscription,
      status: SubscriptionStatus.Suspended,
      updatedAt: new Date().toISOString()
    };

    await activityLogService.log({
      context: input.context,
      action: "subscription.suspended_manual",
      entityType: "subscription",
      entityId: subscription.id,
      reason: input.reason,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>
    });

    const client = await clientService.getById(input.context, subscription.clientId);

    try {
      const balance = activePeriod ? activePeriod.amountUsd - activePeriod.paidAmountUsd : 0;
      await notificationService.send({
        context: input.context,
        clientId: client.id,
        subscriptionId: subscription.id,
        type: CommunicationType.Suspended,
        to: client.phone,
        body: (
          `${client.name}, tu suscripción ${subscription.starlinkAccountId} ha sido suspendida por el administrador. ` +
          `Saldo pendiente: ${(balance + subscription.lateFeeUsd).toFixed(2)} USD. ` +
          `Motivo: ${input.reason}`
        ),
        payload: {
          reason: input.reason,
          suspendedAt: toDateString(new Date()),
          balanceUsd: balance,
          lateFeeUsd: subscription.lateFeeUsd
        }
      });
    } catch {
      // Notification failure should not block state changes
    }

    return updated;
  },

  async reactivate(subscription: Subscription) {
    const before = { ...subscription };
    const updated: Subscription = {
      ...subscription,
      status: SubscriptionStatus.Active,
      updatedAt: new Date().toISOString()
    };

    await subscriptionRepository.update(
      subscription.id,
      subscription.organizationId,
      { status: SubscriptionStatus.Active }
    );

    await activityLogService.log({
      context: {
        organizationId: subscription.organizationId,
        userId: "payment-service",
        role: UserRole.Admin
      },
      action: "subscription.reactivated",
      entityType: "subscription",
      entityId: subscription.id,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>
    });

    return updated;
  },

  /**
   * Obtiene una suscripción con datos enriquecidos para visualización completa en el frontend.
   *
   * MEJORA (Issue #2 en auditoría): El plan original (sección 5.2) especifica que este endpoint
   * debe retornar: datos actuales, cliente, período activo, deuda resumida y último estado calculado.
   *
   * ANTES: Solo retornaba { subscription, periods }, obligando al frontend a hacer 3-4 requests
   * adicionales (GET /clients/{id}, GET /subscriptions/{id}/debt) para mostrar información básica.
   *
   * AHORA: Retorna toda la información necesaria en una sola respuesta:
   * - subscription: datos básicos de la suscripción
   * - client: datos del titular actual
   * - activePeriod: período de facturación pendiente o parcial (si existe)
   * - debt: resumen de deuda vencida y mora
   * - periods: historial completo de períodos
   * - calculated: estado calculado (días hasta vencimiento, si está vencida, estado actualizado)
   *
   * Esto reduce la complejidad del frontend y mejora el rendimiento al evitar múltiples requests.
   */
  async getWithPeriods(context: RequestContext, id: string) {
    const subscription = await subscriptionRepository.getById(context.organizationId, id);
    if (!subscription) {
      throw new NotFoundError(`Suscripción no encontrada (id: ${id})`);
    }

    const periods = await billingPeriodRepository.getBySubscription(context.organizationId, id);

    const client = await clientRepository.getById(context.organizationId, subscription.clientId);
    if (!client) {
      throw new NotFoundError(`Cliente de la suscripción no encontrado (clientId: ${subscription.clientId})`);
    }

    const activePeriod = periods.find(
      (p) => p.status === BillingPeriodStatus.Pending || p.status === BillingPeriodStatus.Partial
    ) || null;

    const debt = await paymentService.calculateDebt(context, id);

    const today = new Date();
    const daysUntilDue = activePeriod
      ? daysUntilNextCutoff(today, subscription.dueDay)
      : null;

    const isOverdue = activePeriod
      ? today > new Date(activePeriod.dueDate + "T23:59:59")
      : false;

    let calculatedStatus: "active" | "overdue" | "suspended" | "paused" | "cancelled" | "unknown";
    if (subscription.status === SubscriptionStatus.Suspended) {
      calculatedStatus = "suspended";
    } else if (subscription.status === SubscriptionStatus.Paused) {
      calculatedStatus = "paused";
    } else if (subscription.status === SubscriptionStatus.Cancelled) {
      calculatedStatus = "cancelled";
    } else if (isOverdue) {
      calculatedStatus = "overdue";
    } else if (subscription.status === SubscriptionStatus.Active) {
      calculatedStatus = "active";
    } else {
      calculatedStatus = "unknown";
    }

    return {
      subscription,
      client: {
        id: client.id,
        name: client.name,
        dni: client.dni,
        phone: client.phone,
        address: client.address
      },
      activePeriod: activePeriod ? {
        id: activePeriod.id,
        startDate: activePeriod.startDate,
        dueDate: activePeriod.dueDate,
        amountUsd: activePeriod.amountUsd,
        paidAmountUsd: activePeriod.paidAmountUsd,
        balanceUsd: Math.max(0, activePeriod.amountUsd - activePeriod.paidAmountUsd),
        status: activePeriod.status
      } : null,
      debt: {
        totalDueUsd: debt.totalDueUsd,
        overduePeriods: debt.overduePeriods.length,
        hasLateFees: debt.overduePeriods.some((p) => p.lateFeeUsd > 0)
      },
      periods,
      calculated: {
        status: calculatedStatus,
        daysUntilDue,
        isOverdue,
        isSuspended: subscription.status === SubscriptionStatus.Suspended
      }
    };
  }
};
