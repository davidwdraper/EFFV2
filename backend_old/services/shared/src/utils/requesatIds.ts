// /backend/services/shared/utils/requestIds.ts
import type { Request } from "express";

const HDRS = ["x-request-id", "x-correlation-id", "x-amzn-trace-id"] as const;

export type RequestIds = {
  requestId?: string;
  correlationId?: string;
  amznTraceId?: string;
};

export function getRequestIds(req: Request): RequestIds {
  const h = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    requestId: h(HDRS[0]) || cryptoRandomId(),
    correlationId: h(HDRS[1]) || undefined,
    amznTraceId: h(HDRS[2]) || undefined,
  };
}

function cryptoRandomId(): string {
  try {
    const { randomBytes } = require("node:crypto");
    return randomBytes(12).toString("hex");
  } catch {
    return Math.random().toString(16).slice(2);
  }
}
