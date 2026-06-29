import { communicationRepository, clientRepository } from "./mockRepositories.js";
import { ValidationError } from "../../domain/errors.js";
import type { RequestContext, Communication, Client } from "../../domain/models.js";

export const communicationService = {
  async getById(context: RequestContext, id: string): Promise<Communication> {
    const communication = await communicationRepository.getById(context.organizationId, id);
    if (!communication) {
      throw new ValidationError(`Comunicación ${id} no encontrada`);
    }
    return communication;
  },

  async listByClient(context: RequestContext, clientId: string, limit?: number): Promise<Communication[]> {
    return await communicationRepository.listByClient(context.organizationId, clientId, limit);
  },

  async getClient(context: RequestContext, clientId: string): Promise<Client> {
    const client = await clientRepository.getById(context.organizationId, clientId);
    if (!client) {
      throw new ValidationError(`Cliente ${clientId} no encontrado`);
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
    const client = await clientRepository.getById(input.context.organizationId, input.clientId);
    if (!client) throw new ValidationError(`Cliente ${input.clientId} no encontrado`);
    return communicationRepository.create({
      organizationId: input.context.organizationId,
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
      type: "manual" as any,
      channel: "whatsapp",
      provider: "twilio",
      status: "sent" as any,
      sentAt: new Date().toISOString(),
      payload: { body: input.body }
    });
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
    return communicationRepository.saveReceived({
      organizationId: input.context.organizationId,
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
      type: "received" as any,
      channel: "whatsapp",
      provider: "twilio",
      status: "received" as any,
      sentAt: new Date().toISOString(),
      payload: { from: input.from, body: input.body, messageSid: input.messageSid }
    });
  }
};
