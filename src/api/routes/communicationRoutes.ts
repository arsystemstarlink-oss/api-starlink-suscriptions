import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { communicationService } from "../../services/communications/communicationService.js";
import { requireAdmin, validateTwilioWebhook } from "../middlewares/requestContext.js";
import { validateBody } from "../validators/validateBody.js";
import { sendManualMessageSchema } from "../validators/schemas.js";
import type { RequestContext } from "../../domain/models.js";

const normalizePhoneNumber = (phone: string): string => {
  let normalized = phone.replace(/^whatsapp:/i, "");
  normalized = normalized.replace(/\s+/g, "");
  if (!normalized.startsWith("+")) {
    normalized = "+" + normalized;
  }
  return normalized;
};

export const webhookRouter = Router();

webhookRouter.post(
  "/twilio",
  validateTwilioWebhook,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { From, Body, MessageSid } = req.body;

      if (!From || !Body) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const context = req.context as RequestContext;
      const normalizedPhone = normalizePhoneNumber(From);
      const client = await communicationService.findClientByPhone(context, normalizedPhone);

      if (!client) {
        console.warn(`Received message from unknown phone: ${From}`);
        res.status(200).send("Message received but client not found");
        return;
      }

      const result = await communicationService.recordReceivedMessage({
        context,
        clientId: client.id,
        from: From,
        body: Body,
        messageSid: MessageSid
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const communicationRouter = Router();

communicationRouter.get(
  "/:communicationId",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = req.context as RequestContext;
      const communicationId = Array.isArray(req.params.communicationId)
        ? req.params.communicationId[0]
        : req.params.communicationId;
      const communication = await communicationService.getById(context, communicationId);
      res.json(communication);
    } catch (error) {
      next(error);
    }
  }
);

communicationRouter.get(
  "/client/:clientId",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = req.context as RequestContext;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const clientId = Array.isArray(req.params.clientId)
        ? req.params.clientId[0]
        : req.params.clientId;
      const communications = await communicationService.listByClient(
        context,
        clientId,
        limit
      );
      res.json(communications);
    } catch (error) {
      next(error);
    }
  }
);

communicationRouter.post(
  "/send",
  requireAdmin,
  validateBody(sendManualMessageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = req.context as RequestContext;
      const { clientId, subscriptionId, body } = req.body;

      const client = await communicationService.getClient(context, clientId);

      const result = await communicationService.sendManualMessage({
        context,
        clientId,
        subscriptionId,
        to: client.phone,
        body
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);
