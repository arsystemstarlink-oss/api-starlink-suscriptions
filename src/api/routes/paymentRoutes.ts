import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { paymentService } from "../../services/payments/paymentService.js";
import { requireAdmin } from "../middlewares/requestContext.js";
import { validateBody } from "../validators/validateBody.js";
import { confirmPaymentSchema, voidPaymentSchema } from "../validators/schemas.js";
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

function p(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

export const paymentRouter = Router();

paymentRouter.post(
  "/:paymentId/confirm",
  requireAdmin,
  validateBody(confirmPaymentSchema),
  handler(async (req, res) => {
    const result = await paymentService.confirm(ctx(req), p(req, "paymentId"));
    res.json(result);
  })
);

paymentRouter.post(
  "/:paymentId/void",
  requireAdmin,
  validateBody(voidPaymentSchema),
  handler(async (req, res) => {
    const result = await paymentService.void(ctx(req), {
      paymentId: p(req, "paymentId"),
      reason: req.body.reason
    });
    res.json(result);
  })
);
