import { communicationRepository } from "../../infrastructure/firestore/repositories.js";
import { clientRepository } from "../../infrastructure/firestore/repositories.js";
import { notificationService } from "../notifications/notificationService.js";
import { NotFoundError } from "../../domain/errors.js";
import type { RequestContext, Communication, Client } from "../../domain/models.js";

export const communicationService = {
  async getById(context: RequestContext, id: string): Promise<Communication> {
    const communication = await communicationRepository.getById(context.organizationId, id);
    
    if (!communication) {
      throw new NotFoundError(`Comunicación no encontrada (id: ${id})`);
    }
    
    return communication;
  },

  async listByClient(context: RequestContext, clientId: string, limit?: number): Promise<Communication[]> {
    return await communicationRepository.listByClient(context.organizationId, clientId, limit);
  },

  async list(
    context: RequestContext,
    filters?: {
      clientId?: string;
      subscriptionId?: string;
      type?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = filters?.page ?? 1;
    const limit = Math.min(filters?.limit ?? 50, 100);

    const allComms = await communicationRepository.listAll(context.organizationId, {
      clientId: filters?.clientId,
      subscriptionId: filters?.subscriptionId,
      type: filters?.type
    });

    const total = allComms.length;
    const totalPages = Math.ceil(total / limit);
    const data = allComms.slice((page - 1) * limit, page * limit);

    return {
      data,
      page,
      limit,
      total,
      totalPages
    };
  },

  async sendClientMessage(input: {
    context: RequestContext;
    clientId: string;
    body: string;
  }): Promise<Communication> {
    const client = await clientRepository.getById(input.context.organizationId, input.clientId);
    if (!client) {
      throw new NotFoundError(`Cliente no encontrado (id: ${input.clientId})`);
    }

    return await notificationService.recordReceived({
      context: input.context,
      clientId: input.clientId,
      from: client.phone,
      body: input.body,
      messageSid: `client-msg-${Date.now()}`
    });
  },

  async getClient(context: RequestContext, clientId: string): Promise<Client> {
    const client = await clientRepository.getById(context.organizationId, clientId);
    
    if (!client) {
      throw new NotFoundError(`Cliente no encontrado (id: ${clientId})`);
    }
    
    return client;
  },

  async findClientByPhone(context: RequestContext, phone: string): Promise<Client | null> {
    return await clientRepository.getByPhone(context.organizationId, phone);
  },

  async sendManualMessage(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    to: string;
    body: string;
  }): Promise<Communication> {
    return await notificationService.sendManual(input);
  },

  async recordReceivedMessage(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    from: string;
    body: string;
    messageSid: string;
    payload?: Record<string, unknown>;
  }): Promise<Communication> {
    return await notificationService.recordReceived(input);
  }
};
