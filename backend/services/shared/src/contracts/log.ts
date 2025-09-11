// backend/services/shared/contracts/log.ts
import { z } from "zod";

// ISO-8601 (UTC "Z" or with offset)
const ISO_DATETIME =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+\-]\d{2}:\d{2}))$/;

// RFC4122 UUID v1–v8 (broad; tighten to [4] for v4-only)
const UUID_RFC4122 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const LogContract = z.object({
  // identity & timestamps
  eventId: z
    .string()
    .regex(UUID_RFC4122, { message: "eventId must be RFC4122 UUID" }),
  timeCreated: z.string().regex(ISO_DATETIME, {
    message: "timeCreated must be ISO-8601 (e.g. 2024-01-02T03:04:05.000Z)",
  }),

  // origin & routing
  service: z.string().min(1).optional(),
  channel: z.enum(["audit", "error"]),
  level: z.enum(["audit", "error"]).or(z.string().min(1)),

  // message & context
  message: z.string().min(1),
  path: z.string().optional(),
  method: z.string().optional(),
  status: z.number().int().optional(),
  requestId: z.string().optional(),
  userId: z.string().optional(),
  entityName: z.string().optional(),
  entityId: z.string().optional(),

  // caller metadata
  sourceFile: z.string().optional(),
  sourceLine: z.number().int().optional(),
  sourceFunction: z.string().optional(),

  // payload bag
  payload: z.record(z.string(), z.any()).optional(),

  // schema version
  v: z.number().int().default(1),
});

export type LogEvent = z.infer<typeof LogContract>;
