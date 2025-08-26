// backend/services/act/src/middleware/methodNotAllowed.ts
import type { Request, Response } from "express";

export function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).type("application/problem+json").json({
    type: "about:blank",
    title: "Method Not Allowed",
    status: 405,
    detail: "This resource is read-only.",
  });
}
