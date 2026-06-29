import type { NextFunction, Request, Response } from "express";
import { authService } from "../../services/auth/authService.js";
import { UnauthorizedError } from "../../domain/errors.js";
import { UserRole } from "../../domain/types.js";
import type { RequestContext } from "../../domain/models.js";

/**
 * Extrae el token Bearer del header `Authorization`.
 *
 * Formato esperado: `Authorization: Bearer <token>`
 *
 * @returns El token sin prefijo, o `null` si el header no existe o tiene formato inválido.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7).trim() || null;
}

/**
 * Middleware que **requiere** un token JWT válido en el header `Authorization`.
 *
 * Si no hay token o es inválido, responde con HTTP 401.
 *
 * Establece `req.context` con los datos del usuario extraídos del payload JWT.
 */
export function authenticateRequired(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);

  if (!token) {
    return next(new UnauthorizedError("Se requiere un token de autenticación"));
  }

  try {
    const payload = authService.verifyToken(token);
    req.context = {
      organizationId: payload.organizationId,
      userId: payload.sub,
      role: payload.role,
      clientId: payload.clientId
    } satisfies RequestContext;
    next();
  } catch {
    next(new UnauthorizedError("Token inválido o expirado"));
  }
}

/**
 * Middleware que combina {@link authenticateRequired} con validación de rol admin.
 *
 * Requiere token JWT válido con `role === "admin"`.
 */
export function authenticateRequiredAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);

  if (!token) {
    return next(new UnauthorizedError("Se requiere un token de autenticación"));
  }

  try {
    const payload = authService.verifyToken(token);

    if (payload.role !== UserRole.Admin) {
      return next(new UnauthorizedError("Esta acción requiere rol admin"));
    }

    req.context = {
      organizationId: payload.organizationId,
      userId: payload.sub,
      role: payload.role,
      clientId: payload.clientId
    } satisfies RequestContext;

    next();
  } catch (error) {
    next(error);
  }
}
