import type { NextFunction, Request, Response } from "express";
import { DomainError } from "../../domain/errors.js";
import { env } from "../../config/env.js";

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof DomainError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  console.error(error);

  const response: any = {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor"
    }
  };

  if (env.NODE_ENV === "development") {
    response.error.details = error.message;
  }

  res.status(500).json(response);
}
