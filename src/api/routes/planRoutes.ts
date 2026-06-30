import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { planService } from "../../services/plans/planService.js";
import { requireAdmin } from "../middlewares/requestContext.js";
import { authenticateRequired } from "../middlewares/authMiddleware.js";
import { validateBody } from "../validators/validateBody.js";
import {
  createPlanSchema,
  updatePlanSchema,
  propagatePlanSchema,
  paginationQuerySchema
} from "../validators/schemas.js";
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

export const planRouter = Router();

planRouter.get("/", authenticateRequired, handler(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const pagination = paginationQuerySchema.parse(req.query);
  const result = await planService.list(ctx(req), includeInactive, pagination);
  res.json(result);
}));

planRouter.get("/:planId", authenticateRequired, handler(async (req, res) => {
  const plan = await planService.getById(ctx(req), p(req, "planId"));
  res.json(plan);
}));

planRouter.post("/", requireAdmin, validateBody(createPlanSchema), handler(async (req, res) => {
  const plan = await planService.create({
    context: ctx(req),
    name: req.body.name,
    priceUsd: req.body.priceUsd,
    lateFeeUsd: req.body.lateFeeUsd,
    graceDays: req.body.graceDays,
    description: req.body.description
  });
  res.status(201).json(plan);
}));

planRouter.put("/:planId", requireAdmin, validateBody(updatePlanSchema), handler(async (req, res) => {
  const updated = await planService.update({
    context: ctx(req),
    planId: p(req, "planId"),
    name: req.body.name,
    priceUsd: req.body.priceUsd,
    lateFeeUsd: req.body.lateFeeUsd,
    graceDays: req.body.graceDays,
    description: req.body.description,
    isActive: req.body.isActive
  });
  res.json(updated);
}));

planRouter.post("/:planId/propagate", requireAdmin, validateBody(propagatePlanSchema), handler(async (req, res) => {
  const result = await planService.propagate({
    context: ctx(req),
    planId: p(req, "planId"),
    preview: req.body.preview
  });
  res.json(result);
}));
