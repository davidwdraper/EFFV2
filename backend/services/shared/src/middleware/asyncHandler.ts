// backend/services/shared/middleware/asyncHandler.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async Express handler so errors go to `next()` instead of being swallowed.
 * Keeps controllers skinny and consistent.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
