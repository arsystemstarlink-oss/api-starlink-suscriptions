import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { subscriptionService } from "../../services/subscriptions/subscriptionService.js";
import { paymentService } from "../../services/payments/paymentService.js";
import { reactivationService } from "../../services/reactivation/reactivationService.js";
import { requireAdmin } from "../middlewares/requestContext.js";
import { validateBody } from "../validators/validateBody.js";
import {
  createSubscriptionSchema,
  transferSubscriptionSchema,
  manualSuspendSchema,
  registerPaymentSchema,
  reactivateSubscriptionSchema
} from "../validators/schemas.js";
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

export const subscriptionRouter = Router({ mergeParams: true });

subscriptionRouter.get(
  "/:subscriptionId",
  handler(async (req, res) => {
    const result = await subscriptionService.getWithPeriods(ctx(req), p(req, "subscriptionId"));
    res.json(result);
  })
);

subscriptionRouter.post(
  "/",
  requireAdmin,
  validateBody(createSubscriptionSchema),
  handler(async (req, res) => {
    const result = await subscriptionService.create({
      context: ctx(req),
      clientId: req.body.clientId,
      code: req.body.code,
      starlinkAccountId: req.body.starlinkAccountId,
      kitId: req.body.kitId,
      planId: req.body.planId,
      dueDay: req.body.dueDay
    });

    res.status(201).json({
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      initialBillingPeriodId: result.billingPeriod.id,
      dueDate: result.billingPeriod.dueDate
    });
  })
);

subscriptionRouter.post(
  "/:subscriptionId/transfer",
  requireAdmin,
  validateBody(transferSubscriptionSchema),
  handler(async (req, res) => {
    const result = await subscriptionService.transfer({
      context: ctx(req),
      subscriptionId: p(req, "subscriptionId"),
      newClientId: req.body.newClientId,
      currentOwnerName: req.body.currentOwnerName,
      currentOwnerDni: req.body.currentOwnerDni,
      reason: req.body.reason
    });
    res.json(result);
  })
);

subscriptionRouter.post(
  "/:subscriptionId/suspend",
  requireAdmin,
  validateBody(manualSuspendSchema),
  handler(async (req, res) => {
    const result = await subscriptionService.suspendManual({
      context: ctx(req),
      subscriptionId: p(req, "subscriptionId"),
      reason: req.body.reason
    });
    res.json(result);
  })
);

subscriptionRouter.post(
  "/:subscriptionId/payments",
  requireAdmin,
  validateBody(registerPaymentSchema),
  handler(async (req, res) => {
    const result = await paymentService.register({
      context: ctx(req),
      billingPeriodId: req.body.billingPeriodId,
      amount: req.body.amount,
      currency: req.body.currency,
      exchangeRate: req.body.exchangeRate,
      reference: req.body.reference,
      proofImage: req.body.proofImage,
      paidAt: req.body.paidAt
    });
    res.status(201).json({
      paymentId: result.id,
      status: result.status
    });
  })
);

subscriptionRouter.get(
  "/:subscriptionId/debt",
  requireAdmin,
  handler(async (req, res) => {
    const result = await paymentService.calculateDebt(ctx(req), p(req, "subscriptionId"));
    res.json(result);
  })
);

subscriptionRouter.get(
  "/:subscriptionId/reactivation-quote",
  requireAdmin,
  handler(async (req, res) => {
    const result = await reactivationService.calculateReactivationQuote(ctx(req), p(req, "subscriptionId"));
    res.json(result);
  })
);

subscriptionRouter.post(
  "/:subscriptionId/reactivate",
  requireAdmin,
  validateBody(reactivateSubscriptionSchema),
  handler(async (req, res) => {
    const result = await reactivationService.reactivate({
      context: ctx(req),
      subscriptionId: p(req, "subscriptionId"),
      paymentIds: req.body.paymentIds,
      expectedTotalUsd: req.body.expectedTotalUsd
    });
    res.json(result);
  })
);
