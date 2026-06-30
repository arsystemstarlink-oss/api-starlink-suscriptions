import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { authService } from "../../services/auth/authService.js";
import { requireAdmin, publicLoginContext } from "../middlewares/requestContext.js";
import { validateBody } from "../validators/validateBody.js";
import { loginSchema, registerSchema, registerClientSchema } from "../validators/schemas.js";
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

export const authPublicRouter = Router();

export const authRouter = Router();

authPublicRouter.post(
  "/login",
  publicLoginContext,
  validateBody(loginSchema),
  handler(async (req, res) => {
    const result = await authService.login({
      context: ctx(req),
      email: req.body.email,
      password: req.body.password
    });
    res.json(result);
  })
);

authRouter.post(
  "/register-client",
  requireAdmin,
  validateBody(registerClientSchema),
  handler(async (req, res) => {
    const result = await authService.registerClient({
      context: ctx(req),
      name: req.body.name,
      dni: req.body.dni,
      phone: req.body.phone,
      address: req.body.address,
      email: req.body.email,
      password: req.body.password
    });
    res.status(201).json(result);
  })
);

authRouter.post(
  "/register",
  requireAdmin,
  validateBody(registerSchema),
  handler(async (req, res) => {
    const result = await authService.register({
      context: ctx(req),
      email: req.body.email,
      password: req.body.password,
      name: req.body.name,
      role: req.body.role,
      clientId: req.body.clientId
    });
    res.status(201).json(result);
  })
);

authRouter.get(
  "/me",
  handler(async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "") ?? "";
    const user = await authService.getUserFromToken(token);
    res.json(user);
  })
);

authRouter.get(
  "/users",
  requireAdmin,
  handler(async (req, res) => {
    const users = await authService.listUsers(ctx(req));
    res.json(users);
  })
);

authRouter.put(
  "/users/:userId/activate",
  requireAdmin,
  handler(async (req, res) => {
    const userId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    await authService.activate(ctx(req), userId);
    res.json({ message: "Usuario activado" });
  })
);

authRouter.put(
  "/users/:userId/deactivate",
  requireAdmin,
  handler(async (req, res) => {
    const userId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    await authService.deactivate(ctx(req), userId);
    res.json({ message: "Usuario desactivado" });
  })
);
