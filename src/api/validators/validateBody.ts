import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../domain/errors.js";

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message
      }));
      console.error("Validation error:", JSON.stringify(issues));
      next(new ValidationError(JSON.stringify(issues)));
      return;
    }

    req.body = result.data;
    next();
  };
}
