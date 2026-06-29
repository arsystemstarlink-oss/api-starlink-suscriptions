import { activityLogRepository } from "../../infrastructure/firestore/repositories.js";
import type { RequestContext } from "../../domain/models.js";

export const activityLogService = {
  async log(input: {
    context: RequestContext;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason?: string;
    metadata?: Record<string, unknown>;
  }) {
    return activityLogRepository.create({
      organizationId: input.context.organizationId,
      actorId: input.context.userId,
      actorRole: input.context.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      reason: input.reason,
      metadata: input.metadata
    });
  }
};
