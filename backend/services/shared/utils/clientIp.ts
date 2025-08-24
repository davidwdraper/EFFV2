// /backend/services/shared/utils/clientIp.ts
import type { Request } from "express";

/**
 * Returns the best-effort client IP without throwing in tests or behind proxies.
 * Order: explicit override (FORCE_CLIENT_IP) → X-Forwarded-For[0] → socket.remoteAddress → req.ip → "unknown"
 */
export function getClientIp(req: Request): string {
  // Test/dev override (harmless in prod)
  if (process.env.FORCE_CLIENT_IP) return process.env.FORCE_CLIENT_IP;

  // Standard proxy chain (first is original client)
  const xff = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff && xff.length > 0) return xff[0];

  // Raw socket IPs (no .address() call; that can be undefined under Supertest)
  const socketRemote = (req.socket as any)?.remoteAddress;
  if (socketRemote && typeof socketRemote === "string") return socketRemote;

  // Express' best-guess
  if ((req as any).ip) return String((req as any).ip);

  return "unknown";
}
