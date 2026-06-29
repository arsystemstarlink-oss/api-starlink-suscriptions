export class DomainError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode = 400) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class BusinessRuleError extends DomainError {
  constructor(message: string) {
    super(message, "BUSINESS_RULE_ERROR", 409);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "No autorizado") {
    super(message, "UNAUTHORIZED", 403);
  }
}
