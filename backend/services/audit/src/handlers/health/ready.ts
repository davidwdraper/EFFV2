// backend/services/audit/src/handlers/health/ready.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Scaling: docs/architecture/backend/SCALING.md
 *
 * Why:
 * - Liveness (/healthz) is dumb and fast; readiness (/readyz) checks deps.
 */

import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { getQueueDepth } from "../../services/ingestQueue";

export default async function ready(
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const checks: Record<string, unknown> = {};
  let ok = true;

  const dbState = mongoose.connection?.readyState;
  const dbOk = dbState === 1;
  checks.db = dbOk ? "ok" : `not-ready(state=${dbState})`;
  if (!dbOk) ok = false;

  const walDir =
    process.env.AUDIT_WAL_DIR || path.join(process.cwd(), "var", "audit-wal");
  let walStatus = "ok";
  try {
    if (!fs.existsSync(walDir)) fs.mkdirSync(walDir, { recursive: true });
    fs.accessSync(walDir, fs.constants.W_OK);
  } catch {
    walStatus = "no-write";
    ok = false;
  }
  checks.walDir = { path: walDir, status: walStatus };

  checks.queue = getQueueDepth();
  checks.process = {
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
  };
  checks.ts = new Date().toISOString();

  res.status(ok ? 200 : 503).json({ ok, checks });
}
