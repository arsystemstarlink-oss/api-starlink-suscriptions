import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { authenticateRequired } from "./api/middlewares/authMiddleware.js";
import { errorHandler } from "./api/middlewares/errorHandler.js";
import { apiRouter } from "./api/routes/index.js";
import { authPublicRouter, authRouter } from "./api/routes/authRoutes.js";
import { webhookRouter } from "./api/routes/communicationRoutes.js";
import { globalRateLimiter, loginRateLimiter } from "./api/middlewares/rateLimiter.js";
import { schedulerService } from "./services/cron/schedulerService.js";
import { schedulerService } from "./services/cron/schedulerService.js";

const app = express();

app.set("trust proxy", true);

app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001', 'https://starlink-subscription-frontend.vercel.app'],
  credentials: true
}));
app.use(morgan("dev"));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => { (req as any).rawBody = buf; }
}));
app.use(express.urlencoded({
  extended: true,
  limit: "1mb",
  verify: (req, _res, buf) => { (req as any).rawBody = buf; }
}));

app.use(globalRateLimiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/cron/config", (_req, res) => {
  const status = schedulerService.getStatus();
  res.json(status);
});

app.use("/api/auth/login", loginRateLimiter);
app.use("/api/auth", authPublicRouter);
app.use("/api/communications/webhook", webhookRouter);

app.use(authenticateRequired);

app.use("/api", apiRouter);
app.use("/api/auth", authRouter);

app.use(errorHandler);

export { app };
