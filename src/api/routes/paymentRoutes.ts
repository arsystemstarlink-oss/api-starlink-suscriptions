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

paymentRouter.get(
  "/",
  handler(async (req, res) => {
    const context = ctx(req);
    const statusParam = req.query.status as string | undefined;
    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : undefined;
    const clientId = req.query.clientId as string | undefined;
    const subscriptionId = req.query.subscriptionId as string | undefined;
    const currency = req.query.currency as string | undefined;
    const fromDate = req.query.from as string | undefined;
    const toDate = req.query.to as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const result = await paymentService.list(context, {
      status: statuses,
      clientId,
      subscriptionId,
      currency,
      fromDate,
      toDate,
      page,
      limit
    });
    res.json(result);
  })
);

paymentRouter.get(
  "/:paymentId",
  handler(async (req, res) => {
    const result = await paymentService.getById(ctx(req), p(req, "paymentId"));
    res.json(result);
  })
);

paymentRouter.post(
  "/:paymentId/confirm",
  requireAdmin,
  validateBody(confirmPaymentSchema),
  handler(async (req, res) => {
    const result = await paymentService.confirm(ctx(req), p(req, "paymentId"), req.body.confirmedAt);
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
