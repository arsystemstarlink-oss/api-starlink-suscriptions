import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAdmin } from "../middlewares/requestContext.js";
import { validateBody } from "../validators/validateBody.js";
import { updateCronConfigSchema } from "../validators/schemas.js";
import { schedulerService } from "../../services/cron/schedulerService.js";
import { dailyJobService } from "../../services/cron/dailyJobService.js";
import type { RequestContext } from "../../domain/models.js";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function handler(fn: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export const cronRouter = Router();

cronRouter.get(
  "/config",
  handler(async (_req, res) => {
    const status = schedulerService.getStatus();
    res.json(status);
  })
);

cronRouter.put(
  "/config",
  requireAdmin,
  validateBody(updateCronConfigSchema),
  handler(async (req, res) => {
    const config = await schedulerService.updateConfig(req.body);
    res.json(config);
  })
);

cronRouter.post(
  "/daily",
  requireAdmin,
  handler(async (req, res) => {
    const context = req.context as RequestContext;
    const result = await dailyJobService.run(context);
    res.json(result);
  })
);
