// backend/services/shared/http/errors.ts
import type { Response } from "express";
import { clean } from "../contracts/clean"; // ← concrete module, no barrels

export const notFound = (res: Response) =>
  res
    .status(404)
    .type("application/problem+json")
    .json(
      clean({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "NOT_FOUND",
        detail: "Resource not found",
      })
    );

export const badRequest = (
  res: Response,
  detail: string,
  extra?: Record<string, unknown>
) =>
  res
    .status(400)
    .type("application/problem+json")
    .json(
      clean({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail,
        ...extra,
      })
    );

export const zValidationError = (res: Response, issues: any[]) =>
  res
    .status(400)
    .type("application/problem+json")
    .json(
      clean({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        code: "VALIDATION_ERROR",
        detail: "Validation failed",
        errors: issues,
      })
    );
