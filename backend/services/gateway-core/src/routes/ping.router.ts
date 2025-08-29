// backend/services/gateway-core/src/routes/ping.router.ts
import { Router } from "express";

export function buildPingRouter() {
  const r = Router();
  r.get("/ping", (_req, res) => res.status(200).json({ pong: true }));
  return r;
}
