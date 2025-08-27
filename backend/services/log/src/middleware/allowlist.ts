// backend/services/log/src/middleware/allowlist.ts
import type { Request, Response, NextFunction } from "express";

const ENFORCE =
  String(process.env.INTERNAL_IP_ENFORCE || "").toLowerCase() === "true";
const RAW = (process.env.INTERNAL_IP_ALLOWLIST || "").trim();

/** Minimal IPv4 CIDR + exact-IP allowlist. If ENFORCE=false, middleware is no-op. */
export function enforceAllowlist(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!ENFORCE) return next();
  if (!RAW)
    throw new Error(
      "INTERNAL_IP_ENFORCE=true but INTERNAL_IP_ALLOWLIST is missing"
    );

  const ip = req.ip; // honor trust proxy at app level
  if (!ip) {
    return res
      .status(403)
      .json({ error: { code: "FORBIDDEN_NETWORK", message: "No source IP" } });
  }

  if (isAllowed(ip, RAW)) return next();

  return res
    .status(403)
    .json({
      error: { code: "FORBIDDEN_NETWORK", message: "Source IP not allowed" },
    });
}

function isAllowed(ip: string, list: string): boolean {
  const items = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const item of items) {
    if (item.includes("/")) {
      if (cidrContains(item, ip)) return true;
    } else {
      if (ip === item) return true;
    }
  }
  return false;
}

// IPv4 only; exact-match path handles IPv6. Keep simple; infra should fence at network too.
function cidrContains(cidr: string, ip: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const nip = ipToInt(ip);
  const nnet = ipToInt(net);
  if (nip === null || nnet === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (nip & mask) === (nnet & mask);
}
function ipToInt(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => Number(p));
  if (n.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return null;
  return ((n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3]) >>> 0;
}
