import type { NextFunction, Request, Response } from "express";
import twilio from "twilio";
import { UnauthorizedError } from "../../domain/errors.js";
import { UserRole } from "../../domain/types.js";
import { env } from "../../config/env.js";
import type { RequestContext } from "../../domain/models.js";

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
      rawBody?: Buffer;
    }
  }
}

function parseRole(value: string | undefined): UserRole {
  if (value === UserRole.Client) {
    return UserRole.Client;
  }

  return UserRole.Admin;
}

export function resolveRequestContext(req: Request, _res: Response, next: NextFunction) {
  const organizationId = req.header("x-organization-id") ?? env.ORGANIZATION_ID;
  const userId = req.header("x-user-id") ?? env.DEFAULT_ADMIN_ID;
  const role = parseRole(req.header("x-user-role"));
  const clientId = req.header("x-user-client-id");

  req.context = {
    organizationId,
    userId,
    role,
    clientId
  } satisfies RequestContext;

  next();
}

export function publicLoginContext(_req: Request, _res: Response, next: NextFunction) {
  _req.context = {
    organizationId: env.ORGANIZATION_ID,
    userId: "anonymous",
    role: UserRole.Client
  } satisfies RequestContext;

  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const context = req.context as RequestContext | undefined;

  if (context?.role !== UserRole.Admin) {
    next(new UnauthorizedError("Esta acción requiere rol admin"));
    return;
  }

  next();
}

export function requireClient(req: Request, _res: Response, next: NextFunction) {
  const context = req.context as RequestContext | undefined;

  if (context?.role !== UserRole.Client) {
    next(new UnauthorizedError("Esta acción requiere rol client"));
    return;
  }

  if (!context?.clientId) {
    next(new UnauthorizedError("Usuario de tipo client debe tener clientId asociado"));
    return;
  }

  next();
}

export function requireHuman(req: Request, _res: Response, next: NextFunction) {
  const context = req.context as RequestContext | undefined;

  if (!context?.userId || context.userId === "anonymous") {
    next(new UnauthorizedError("Esta acción requiere un usuario autenticado"));
    return;
  }

  next();
}

function buildWebhookUrl(req: Request): string {
  if (env.TWILIO_WEBHOOK_URL) {
    const base = env.TWILIO_WEBHOOK_URL.replace(/\/+$/, "");
    const path = req.originalUrl.split("?")[0];
    return base + path;
  }

  const protocol = (req.header("x-forwarded-proto") ?? req.protocol) as string;
  const host = req.header("x-forwarded-host") ?? req.header("host") ?? "localhost";
  const path = req.originalUrl.split("?")[0];
  return `${protocol}://${host}${path}`;
}

export function validateTwilioWebhook(req: Request, _res: Response, next: NextFunction) {
  const signature = req.headers["x-twilio-signature"] as string | undefined;

  if (!signature) {
    next(new UnauthorizedError("Missing Twilio signature"));
    return;
  }

  const authToken = env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not configured; skipping signature validation");
    next(new UnauthorizedError("Server not configured for webhook validation"));
    return;
  }

  const url = buildWebhookUrl(req);

  let isValid = false;

  try {
    const parsedUrl = new URL(url);
    const bodySHA256 = parsedUrl.searchParams.get("bodySHA256");

    if (bodySHA256) {
      const rawBody = req.rawBody ? req.rawBody.toString("utf-8") : "";
      isValid = twilio.validateRequestWithBody(authToken, signature, url, rawBody);
    } else {
      const params = (req.body && typeof req.body === "object") ? req.body : {};
      isValid = twilio.validateRequest(authToken, signature, url, params);
    }
  } catch (error) {
    console.error("Error validating Twilio webhook signature:", error);
    next(new UnauthorizedError("Invalid webhook signature"));
    return;
  }

  if (!isValid) {
    next(new UnauthorizedError("Invalid Twilio signature"));
    return;
  }

  req.context = {
    organizationId: env.ORGANIZATION_ID,
    userId: "twilio-webhook",
    role: UserRole.Admin
  } satisfies RequestContext;

  next();
}
