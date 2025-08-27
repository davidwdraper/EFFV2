// backend/services/act/src/controllers/act/handlers/create.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import {
  zActCreate,
  zActDto,
  clean,
  respond,
  zodBadRequest,
} from "../../../contracts/act";
import * as repo from "../../../repo/actRepo";
import { toActDto } from "../../../dto/actDto";

const IS_TEST = process.env.NODE_ENV === "test";

function isMongooseValidation(err: any) {
  return (
    err?.name === "ValidationError" ||
    err?._message === "Validation failed" ||
    err?.errors
  );
}
function isDuplicate(err: any) {
  return (
    err?.code === 11000 ||
    err?.code === "11000" ||
    (typeof err?.message === "string" &&
      /E11000 duplicate key/i.test(err.message))
  );
}

function normalizeHomeTownLoc(input: any) {
  if (!input || typeof input !== "object") return input;
  const loc = input.homeTownLoc;
  if (!loc || typeof loc !== "object") return input;

  let lng: number | undefined;
  let lat: number | undefined;

  if (
    Array.isArray((loc as any).coordinates) &&
    (loc as any).coordinates.length === 2
  ) {
    let [c0, c1] = (loc as any).coordinates;
    c0 = typeof c0 === "string" ? Number(c0) : c0;
    c1 = typeof c1 === "string" ? Number(c1) : c1;
    const firstLooksLat = typeof c0 === "number" && Math.abs(c0) <= 90;
    const secondLooksLng =
      typeof c1 === "number" && Math.abs(c1) > 90 && Math.abs(c1) <= 180;
    if (firstLooksLat && secondLooksLng) [c0, c1] = [c1, c0];
    lng = c0;
    lat = c1;
  }

  if (lng === undefined && lat === undefined) {
    const rawLng = (loc as any).lng ?? (loc as any).longitude;
    const rawLat = (loc as any).lat ?? (loc as any).latitude;
    if (rawLng != null && rawLat != null) {
      lng = typeof rawLng === "string" ? Number(rawLng) : rawLng;
      lat = typeof rawLat === "string" ? Number(rawLat) : rawLat;
    }
  }

  if (typeof lng === "number" && typeof lat === "number") {
    input.homeTownLoc = {
      type: (loc as any).type ?? "Point",
      coordinates: [lng, lat],
    };
  }
  return input;
}
function normalizeTimes(input: any) {
  const pad = (s: string) => {
    const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
    if (!m) return s;
    const hh = m[1].padStart(2, "0");
    return m[3] ? `${hh}:${m[2]}:${m[3]}` : `${hh}:${m[2]}`;
  };
  if (typeof input.earliestStartTime === "string")
    input.earliestStartTime = pad(input.earliestStartTime);
  if (typeof input.latestStartTime === "string")
    input.latestStartTime = pad(input.latestStartTime);
  return input;
}
function normalizeActType(input: any) {
  const at = input.actType;
  if (Array.isArray(at)) return input;
  if (Number.isInteger(at)) input.actType = [at];
  else if (typeof at === "string" && /^\d+$/.test(at))
    input.actType = [Number(at)];
  return input;
}

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const raw: any = { ...(req.body ?? {}) };
  delete raw.dateCreated;
  delete raw.dateLastUpdated;

  if (IS_TEST) console.error("[create] raw payload:", JSON.stringify(raw));

  normalizeHomeTownLoc(raw);
  normalizeTimes(raw);
  normalizeActType(raw);

  if (IS_TEST)
    console.error("[create] normalized payload:", JSON.stringify(raw));

  const parsed = zActCreate.safeParse(raw);
  if (!parsed.success) {
    if (IS_TEST) {
      console.error(
        "[create] zod issues:",
        parsed.error.issues.map((i) => ({
          path: i.path?.join("."),
          code: i.code,
          message: i.message,
        }))
      );
    }
    return zodBadRequest(res, parsed.error);
  }

  const body = parsed.data;

  try {
    // ⬇️ Solve TS mismatch at the call boundary (runtime is fine)
    const created = await repo.create(body as any);

    if (IS_TEST)
      console.error(
        "[create] repo.create ok _id:",
        (created as any)?._id ?? "(no id)"
      );
    return respond(res, zActDto, toActDto(created), 201);
  } catch (err: any) {
    if (IS_TEST) {
      console.error("[create] repo error:", {
        name: err?.name,
        code: err?.code,
        message: err?.message,
        errors: err?.errors,
      });
    }
    if (isDuplicate(err) && body?.name) {
      const existing = await repo.findByName(body.name);
      if (existing) return respond(res, zActDto, toActDto(existing), 201);
    }
    if (isMongooseValidation(err)) {
      return res
        .status(400)
        .type("application/problem+json")
        .json(
          clean({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            code: "BAD_REQUEST",
            detail: String(err?.message || "Validation failed"),
          })
        );
    }
    throw err;
  }
});
