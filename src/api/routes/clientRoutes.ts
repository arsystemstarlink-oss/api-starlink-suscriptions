import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { clientService } from "../../services/clients/clientService.js";
import { subscriptionRepository } from "../../infrastructure/firestore/repositories.js";
import { requireAdmin } from "../middlewares/requestContext.js";
import { validateBody } from "../validators/validateBody.js";
import { createClientSchema, updateClientSchema, paginationQuerySchema } from "../validators/schemas.js";
import type { RequestContext } from "../../domain/models.js";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function handler(fn: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
}

function ctx(req: Request) {
  return req.context as RequestContext;
}

function p(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

export const clientRouter = Router();

clientRouter.get(
  "/",
  requireAdmin,
  handler(async (req, res) => {
    const pagination = paginationQuerySchema.parse(req.query);
    const result = await clientService.list(ctx(req), pagination);
    res.json(result);
  })
);

clientRouter.post(
  "/",
  requireAdmin,
  validateBody(createClientSchema),
  handler(async (req, res) => {
    const client = await clientService.create({
      context: ctx(req),
      name: req.body.name,
      dni: req.body.dni,
      phone: req.body.phone,
      address: req.body.address
    });
    res.status(201).json(client);
  })
);

clientRouter.get(
  "/:clientId",
  handler(async (req, res) => {
    const client = await clientService.getById(ctx(req), p(req, "clientId"));
    const subscriptions = await subscriptionRepository.listByClientId(
      ctx(req).organizationId,
      client.id
    );

    const summary = subscriptions.map((sub) => ({
      id: sub.id,
      starlinkAccountId: sub.starlinkAccountId,
      plan: sub.planName,
      planId: sub.planId,
      status: sub.status,
      priceUsd: sub.priceUsd,
      dueDay: sub.dueDay
    }));

    res.json({ ...client, subscriptions: summary });
  })
);

clientRouter.put(
  "/:clientId",
  requireAdmin,
  validateBody(updateClientSchema),
  handler(async (req, res) => {
    const updated = await clientService.update(ctx(req), p(req, "clientId"), req.body);
    res.json(updated);
  })
);

clientRouter.delete(
  "/:clientId",
  requireAdmin,
  handler(async (req, res) => {
    const clientId = p(req, "clientId");
    await clientService.delete(ctx(req), clientId);
    res.status(204).send();
  })
);
