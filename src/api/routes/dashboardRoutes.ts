import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAdmin } from "../middlewares/requestContext.js";
import { dashboardService } from "../../services/dashboard/dashboardService.js";
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

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  requireAdmin,
  handler(async (req, res) => {
    const result = await dashboardService.getSummary(ctx(req));
    res.json(result);
  })
);

dashboardRouter.get(
  "/urgent-actions",
  requireAdmin,
  handler(async (req, res) => {
    const result = await dashboardService.getUrgentActions(ctx(req));
    res.json(result);
  })
);

dashboardRouter.get(
  "/week-agenda",
  requireAdmin,
  handler(async (req, res) => {
    const result = await dashboardService.getWeekAgenda(ctx(req));
    res.json(result);
  })
);

dashboardRouter.get(
  "/notifications-count",
  requireAdmin,
  handler(async (req, res) => {
    const result = await dashboardService.getNotificationsCount(ctx(req));
    res.json(result);
  })
);
