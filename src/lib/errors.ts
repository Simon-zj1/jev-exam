export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "validation_error");
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "请先登录") {
    super(message, 401, "unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "无权访问该资源") {
    super(message, 403, "forbidden");
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "资源不存在") {
    super(message, 404, "not_found");
    this.name = "NotFoundError";
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string) {
    super(message, 429, "quota_exceeded");
    this.name = "QuotaExceededError";
  }
}

export function toErrorResponse(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : "服务器内部错误";
  return { status: 500, body: { error: message, code: "internal_error" } };
}
