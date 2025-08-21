// backend/services/shared/contracts/common.ts
import { z, ZodError } from "zod";
import type { Response } from "express";

/** Mongo ObjectId (24 hex chars) */
export const zObjectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Expected 24-hex Mongo ObjectId");

/** Strict ISO 8601 date-time (string) like 2025-08-21T19:03:11.123Z or with offset */
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** ISO date-time (accepts Date or ISO string). Controllers will normalize to .toISOString() */
export const zIsoDate = z.union([
  z.string().regex(ISO_DATETIME_RE, "Expected ISO 8601 date-time string"),
  z.date(),
]);

/** Pagination query */
export const zPagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Geo query (lat/lng + miles) */
export const zGeoQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  miles: z.coerce.number().min(0.1).max(500).default(25),
});

/** Time-of-day "HH:MM" or "HH:MM:SS" (24h) */
export const zTimeOfDay = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
    'Expected "HH:MM" or "HH:MM:SS"'
  );

/** Standard list response shape factory */
export const zListResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0),
    items: z.array(item),
  });

/** Problem+JSON helper for Zod validation errors */
export function zodBadRequest(res: Response, error: ZodError) {
  const errors = error.issues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
    code: i.code,
    message: i.message,
  }));
  return res.status(400).json({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    detail: "Validation failed",
    errors,
  });
}

/** Strip undefined (stable wire format) */
export function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** Require env (fail fast) */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

/** Output guard: validate payload before sending */
export function respond<T extends z.ZodTypeAny>(
  res: Response,
  schema: T,
  payload: unknown,
  status = 200
) {
  const out = schema.parse(payload);
  return res.status(status).json(out);
}
