import { planRepository, subscriptionRepository } from "../../infrastructure/firestore/repositories.js";
import { getFirestore } from "../../infrastructure/firestore/firestore.js";
import { BusinessRuleError, NotFoundError } from "../../domain/errors.js";
import type { Plan, RequestContext, Subscription, PaginationParams, PaginatedResult } from "../../domain/models.js";
import { SubscriptionStatus } from "../../domain/types.js";
import { activityLogService } from "../audit/activityLogService.js";

export const planService = {
  async create(input: {
    context: RequestContext;
    name: string;
    code: string;
    priceUsd: number;
    lateFeeUsd: number;
    graceDays: number;
    description?: string;
  }) {
    const existing = await planRepository.getByCode(input.context.organizationId, input.code);
    if (existing) {
      throw new BusinessRuleError("Ya existe un plan con ese código");
    }

    const plan = await planRepository.create({
      organizationId: input.context.organizationId,
      name: input.name,
      code: input.code,
      priceUsd: input.priceUsd,
      lateFeeUsd: input.lateFeeUsd,
      graceDays: input.graceDays,
      description: input.description,
      isActive: true
    });

    await activityLogService.log({
      context: input.context,
      action: "plan.created",
      entityType: "plan",
      entityId: plan.id,
      after: plan as unknown as Record<string, unknown>
    });

    return plan;
  },

  async getById(context: RequestContext, id: string): Promise<Plan> {
    const plan = await planRepository.getById(context.organizationId, id);
    if (!plan) {
      throw new NotFoundError(`Plan no encontrado (id: ${id})`);
    }
    return plan;
  },

  async list(context: RequestContext, includeInactive = false, pagination?: PaginationParams): Promise<PaginatedResult<Plan>> {
    return planRepository.list(context.organizationId, includeInactive, pagination);
  },

  async update(input: {
    context: RequestContext;
    planId: string;
    name?: string;
    priceUsd?: number;
    lateFeeUsd?: number;
    graceDays?: number;
    description?: string;
    isActive?: boolean;
  }) {
    const plan = await this.getById(input.context, input.planId);
    const before = { ...plan };

    const updateData: Partial<Plan> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.priceUsd !== undefined) updateData.priceUsd = input.priceUsd;
    if (input.lateFeeUsd !== undefined) updateData.lateFeeUsd = input.lateFeeUsd;
    if (input.graceDays !== undefined) updateData.graceDays = input.graceDays;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    await planRepository.update(input.planId, input.context.organizationId, updateData);
    const updated = await this.getById(input.context, input.planId);

    await activityLogService.log({
      context: input.context,
      action: "plan.updated",
      entityType: "plan",
      entityId: input.planId,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>
    });

    return updated;
  },

  async propagate(input: {
    context: RequestContext;
    planId: string;
    preview: boolean;
  }) {
    const plan = await this.getById(input.context, input.planId);

    const subscriptions = await subscriptionRepository.listByPlanId(
      input.context.organizationId,
      input.planId
    );

    const candidates = subscriptions.filter(
      s => s.status !== SubscriptionStatus.Cancelled
    );

    const changes = candidates.map(s => ({
      subscriptionId: s.id,
      code: s.code,
      status: s.status,
      currentPriceUsd: s.priceUsd,
      currentLateFeeUsd: s.lateFeeUsd,
      currentGraceDays: s.graceDays,
      newPriceUsd: plan.priceUsd,
      newLateFeeUsd: plan.lateFeeUsd,
      newGraceDays: plan.graceDays
    }));

    if (input.preview) {
      return {
        plan,
        preview: true,
        affectedSubscriptions: candidates.length,
        changes
      };
    }

    /**
     * Atomicidad: Firestore WriteBatch
     *
     * Usa writeBatch para garantizar que todas las actualizaciones de
     * suscripciones se apliquen atómicamente. Si alguna operación falla,
     * ninguna se aplica, evitando el estado inconsistente donde algunas
     * suscripciones tuvieran el precio nuevo y otras el viejo.
     *
     * NOTA: Firestore limita los batches a 500 operaciones por batch.
     * Para más de 500 suscripciones, se dividen en múltiples batches
     * secuenciales. Si falla un batch intermedio, los anteriores ya
     * aplicados quedan, pero al menos cada batch individual es atómico.
     */
    const BATCH_LIMIT = 500;
    const now = new Date().toISOString();
    const affectedIds: string[] = [];
    const db = getFirestore();

    for (let i = 0; i < candidates.length; i += BATCH_LIMIT) {
      const chunk = candidates.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();

      for (const sub of chunk) {
        const ref = subscriptionRepository.getRef(sub.organizationId, sub.id);
        batch.update(ref, {
          priceUsd: plan.priceUsd,
          lateFeeUsd: plan.lateFeeUsd,
          graceDays: plan.graceDays,
          planName: plan.name,
          updatedAt: now
        });
        affectedIds.push(sub.id);
      }

      await batch.commit();
    }

    await activityLogService.log({
      context: input.context,
      action: "plan.priced_propagated",
      entityType: "plan",
      entityId: input.planId,
      before: plan as unknown as Record<string, unknown>,
      after: plan as unknown as Record<string, unknown>,
      metadata: { affectedSubscriptions: affectedIds }
    });

    return {
      plan,
      preview: false,
      affectedSubscriptions: affectedIds.length,
      changes
    };
  }
};
