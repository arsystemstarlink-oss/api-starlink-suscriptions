import twilio from "twilio";
import { env } from "../../config/env.js";
import { communicationRepository } from "../../infrastructure/firestore/repositories.js";
import type { RequestContext } from "../../domain/models.js";
import { CommunicationStatus, CommunicationType } from "../../domain/types.js";
import { activityLogService } from "../audit/activityLogService.js";
import { eventBus, EventName } from "../../infrastructure/events/eventBus.js";

const enabled = Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM && env.TWILIO_WHATSAPP_TO
);

const client = enabled
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : undefined;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Whitelist de SIDs de plantillas aprobadas por WhatsApp/Meta
const APPROVED_TEMPLATE_SIDS = new Set<string>(
  [
    env.TWILIO_WHATSAPP_REMINDER_SID,
    env.TWILIO_WHATSAPP_CUTOFF_SID,
    env.TWILIO_WHATSAPP_SUSPENDED_SID
  ].filter((sid): sid is string => Boolean(sid))
);

// Mapeo de tipos de comunicación a SIDs de plantillas de WhatsApp
const TEMPLATE_MAPPING: Record<string, string> = {
  "payment_reminder": env.TWILIO_WHATSAPP_REMINDER_SID || "",
  "overdue": env.TWILIO_WHATSAPP_CUTOFF_SID || "",
  "suspended": env.TWILIO_WHATSAPP_SUSPENDED_SID || "",
  "payment_confirmed": env.TWILIO_WHATSAPP_CUTOFF_SID || ""
};

/**
 * Obtiene el SID de plantilla correcto según el tipo de comunicación
 * @throws Error si el template no está en la whitelist
 */
function getTemplateSid(type: CommunicationType, explicitSid?: string): string {
  const sid = explicitSid || TEMPLATE_MAPPING[type] || "";
  
  if (!sid) {
    throw new Error(`No hay plantilla configurada para tipo "${type}". No se puede enviar WhatsApp sin template aprobado.`);
  }
  
  if (!APPROVED_TEMPLATE_SIDS.has(sid)) {
    throw new Error(`Template SID "${sid}" no está en la whitelist de plantillas aprobadas.`);
  }
  
  return sid;
}

export const notificationService = {
  async send(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    type: CommunicationType;
    to: string;
    body?: string;
    templateVariables?: Record<string, string>;
    templateSid?: string; // Permite override manual del SID de plantilla
    payload: Record<string, unknown>;
  }) {
    const communication = await communicationRepository.create({
      organizationId: input.context.organizationId,
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
      type: input.type,
      channel: "whatsapp",
      provider: "twilio",
      status: CommunicationStatus.Queued,
      payload: input.payload
    });

    if (!client || !env.TWILIO_WHATSAPP_FROM) {
      console.warn("Twilio no configurado. Comunicación registrada sin envío:", communication.id);
      return communication;
    }

    const toNumber = input.to.startsWith("whatsapp:") ? input.to : `whatsapp:${input.to}`;
    
    // Validar template ANTES del loop (si falta, falla inmediatamente)
    const templateSid = getTemplateSid(input.type, input.templateSid);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // SIEMPRE enviar con template aprobado de WhatsApp (no se permite texto libre)
        const msgData: any = {
          from: env.TWILIO_WHATSAPP_FROM,
          to: toNumber,
          contentSid: templateSid
        };
        
        // Agregar variables del template si existen
        if (input.templateVariables && Object.keys(input.templateVariables).length > 0) {
          msgData.contentVariables = JSON.stringify(input.templateVariables);
        }
        
        await client.messages.create(msgData);

        const sentAt = new Date().toISOString();
        await communicationRepository.update(communication.id, communication.organizationId, {
          status: CommunicationStatus.Sent,
          sentAt
        });

        await activityLogService.log({
          context: input.context,
          action: "communication.sent",
          entityType: "communication",
          entityId: communication.id,
          after: {
            type: input.type,
            clientId: input.clientId,
            subscriptionId: input.subscriptionId,
            channel: "whatsapp",
            templateSid,
            sentAt,
            attempt
          } as unknown as Record<string, unknown>
        });

        const sentCommunication = { ...communication, status: CommunicationStatus.Sent, sentAt };
        
        eventBus.emit(EventName.COMMUNICATION_SENT, sentCommunication);
        
        return sentCommunication;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Error enviando WhatsApp");

        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    const errorMessage = lastError?.message ?? "Error enviando WhatsApp tras múltiples intentos";

    await communicationRepository.update(communication.id, communication.organizationId, {
      status: CommunicationStatus.Failed,
      errorMessage
    });

    await activityLogService.log({
      context: input.context,
      action: "communication.failed",
      entityType: "communication",
      entityId: communication.id,
      after: {
        type: input.type,
        clientId: input.clientId,
        subscriptionId: input.subscriptionId,
        channel: "whatsapp",
        templateSid,
        errorMessage,
        attempts: MAX_RETRIES
      } as unknown as Record<string, unknown>
    });

    return { ...communication, status: CommunicationStatus.Failed, errorMessage };
  },

  async sendManual(input: {
    context: RequestContext;
    clientId: string;
    subscriptionId?: string;
    to: string;
    body: string;
    payload?: Record<string, unknown>;
  }) {
    if (!client || !env.TWILIO_WHATSAPP_FROM) {
      throw new Error("Twilio no está configurado. No se puede enviar mensajes manuales.");
    }

    if (!input.body || input.body.trim().length === 0) {
      throw new Error("El mensaje no puede estar vacío");
    }

    if (input.body.length > 4096) {
      throw new Error("WhatsApp limita los mensajes a 4096 caracteres");
    }

    const toNumber = input.to.startsWith("whatsapp:") ? input.to : `whatsapp:${input.to}`;

    const communication = await communicationRepository.create({
      organizationId: input.context.organizationId,
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
      type: CommunicationType.Manual,
      channel: "whatsapp",
      provider: "twilio",
      status: CommunicationStatus.Queued,
      payload: {
        ...(input.payload ?? {}),
        sentBy: input.context.userId,
        direction: "outbound"
      }
    });

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await client.messages.create({
          from: env.TWILIO_WHATSAPP_FROM,
          to: toNumber,
          body: input.body
        });

        const sentAt = new Date().toISOString();
        await communicationRepository.update(communication.id, communication.organizationId, {
          status: CommunicationStatus.Sent,
          sentAt
        });

        const afterData: Record<string, unknown> = {
          type: CommunicationType.Manual,
          clientId: input.clientId,
          channel: "whatsapp",
          body: input.body,
          to: input.to,
          sentAt
        };
        if (input.subscriptionId) {
          afterData.subscriptionId = input.subscriptionId;
        }

        await activityLogService.log({
          context: input.context,
          action: "communication.manual_sent",
          entityType: "communication",
          entityId: communication.id,
          after: afterData as unknown as Record<string, unknown>
        });

        const sentCommunication = { ...communication, status: CommunicationStatus.Sent, sentAt };
        
        eventBus.emit(EventName.COMMUNICATION_SENT, sentCommunication);
        
        return sentCommunication;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Error enviando WhatsApp");

        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    const errorMessage = lastError?.message ?? "Error enviando WhatsApp tras múltiples intentos";

    await communicationRepository.update(communication.id, communication.organizationId, {
      status: CommunicationStatus.Failed,
      errorMessage
    });

    return { ...communication, status: CommunicationStatus.Failed, errorMessage };
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
    const communication = await communicationRepository.saveReceived({
      organizationId: input.context.organizationId,
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
      type: CommunicationType.Received,
      channel: "whatsapp",
      provider: "twilio",
      status: CommunicationStatus.Received,
      sentAt: new Date().toISOString(),
      payload: {
        ...(input.payload ?? {}),
        from: input.from,
        messageSid: input.messageSid,
        direction: "inbound"
      }
    });

    await activityLogService.log({
      context: input.context,
      action: "communication.received",
      entityType: "communication",
      entityId: communication.id,
      after: {
        type: CommunicationType.Received,
        clientId: input.clientId,
        ...(input.subscriptionId && { subscriptionId: input.subscriptionId }),
        channel: "whatsapp",
        payload: { from: input.from, body: input.body, messageSid: input.messageSid },
        receivedAt: communication.sentAt
      }
    });

    eventBus.emit(EventName.COMMUNICATION_RECEIVED, communication);

    return communication;
  }
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
