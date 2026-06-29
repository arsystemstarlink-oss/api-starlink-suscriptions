import { communicationRepository } from "./mockRepositories.js";
import type { RequestContext } from "../../domain/models.js";

export const notificationService = {
  async send(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    type: any;
    to: string;
    body?: string;
    templateVariables?: Record<string, string>;
    templateSid?: string;
    payload: Record<string, unknown>;
  }) {
    return communicationRepository.create({
      organizationId: input.context.organizationId,
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
      type: input.type,
      channel: "whatsapp",
      provider: "twilio",
      status: "sent" as any,
      sentAt: new Date().toISOString(),
      payload: input.payload
    });
  },

  async sendManual(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    to: string;
    body: string;
    payload?: Record<string, unknown>;
  }) {
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

  async recordReceived(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    from: string;
    body: string;
    messageSid: string;
    payload?: Record<string, unknown>;
  }) {
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
