import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireClient } from "../middlewares/requestContext.js";
import { subscriptionService } from "../../services/subscriptions/subscriptionService.js";
import { paymentService } from "../../services/payments/paymentService.js";
import { clientService } from "../../services/clients/clientService.js";
import { communicationService } from "../../services/communications/communicationService.js";
import { BusinessRuleError } from "../../domain/errors.js";
import type { RequestContext } from "../../domain/models.js";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function handler(fn: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function ctx(req: Request) {
  return req.context as RequestContext;
}

/**
 * Router para el portal del cliente.
 *
 * Todos los endpoints requieren rol `client` y extraen el `clientId`
 * del contexto de autenticación (JWT). El cliente solo puede ver
 * sus propios datos, nunca datos de otros clientes.
 */
export const clientPortalRouter = Router();

/**
 * GET /api/client/profile
 *
 * Retorna los datos del perfil del cliente autenticado.
 */
clientPortalRouter.get(
  "/profile",
  requireClient,
  handler(async (req, res) => {
    const context = ctx(req);
    const client = await clientService.getById(context, context.clientId!);
    res.json(client);
  })
);

/**
 * GET /api/client/subscription
 *
 * Retorna la suscripción del cliente con datos enriquecidos.
 * Si el cliente no tiene suscripción, retorna null en subscription.
 */
clientPortalRouter.get(
  "/subscription",
  requireClient,
  handler(async (req, res) => {
    const context = ctx(req);

    const subscriptions = await subscriptionService.listByClient(context, context.clientId!);

    if (subscriptions.length === 0) {
      res.json({ subscription: null });
      return;
    }

    const subscription = subscriptions[0];
    const enriched = await subscriptionService.getWithPeriods(context, subscription.id);
    res.json(enriched);
  })
);

/**
 * GET /api/client/payments
 *
 * Retorna el historial de pagos del cliente.
 * Ordenado por fecha descendente (más recientes primero).
 */
clientPortalRouter.get(
  "/payments",
  requireClient,
  handler(async (req, res) => {
    const context = ctx(req);
    const payments = await paymentService.listByClient(context, context.clientId!);
    res.json({ payments });
  })
);

/**
 * GET /api/client/debt
 *
 * Retorna el resumen de deuda del cliente.
 */
clientPortalRouter.get(
  "/debt",
  requireClient,
  handler(async (req, res) => {
    const context = ctx(req);

    const subscriptions = await subscriptionService.listByClient(context, context.clientId!);

    if (subscriptions.length === 0) {
      res.json({
        subscriptionId: null,
        status: null,
        overduePeriods: [],
        advance: null,
        totalDueUsd: 0
      });
      return;
    }

    const subscription = subscriptions[0];
    const debt = await paymentService.calculateDebt(context, subscription.id);
    res.json(debt);
  })
);

clientPortalRouter.get(
  "/communications",
  requireClient,
  handler(async (req, res) => {
    const context = ctx(req);
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string), 100) : 50;

    const result = await communicationService.list(context, {
      clientId: context.clientId!,
      page,
      limit
    });
    res.json(result);
  })
);

clientPortalRouter.post(
  "/communications/send",
  requireClient,
  handler(async (req, res) => {
    const context = ctx(req);
    const { body } = req.body;

    if (!body || typeof body !== "string" || body.trim().length === 0) {
      throw new BusinessRuleError("El mensaje no puede estar vacío");
    }

    if (body.length > 4096) {
      throw new BusinessRuleError("El mensaje no puede exceder 4096 caracteres");
    }

    const result = await communicationService.sendClientMessage({
      context,
      clientId: context.clientId!,
      body: body.trim()
    });

    res.status(201).json({
      id: result.id,
      type: result.type,
      status: result.status,
      body: body.trim(),
      createdAt: result.createdAt
    });
  })
);
