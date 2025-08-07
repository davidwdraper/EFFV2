// src/middleware/authGate.ts
import { Request, Response, NextFunction } from "express";

type GateOpts = {
  /** Exact path matches (no querystring). Example: "/acts/hometowns" */
  publicGetPaths?: string[];
  /** Regex matchers for paths. Example: [/^\/acts\/hometowns$/, /^\/acts\/hometowns\/near$/] */
  publicGetRegexes?: RegExp[];
};

function sanitizePath(url: string): string {
  // strip CR/LF, trim, then remove query/hash
  const cleaned = (url || "").replace(/[\r\n]+/g, "").trim();
  return cleaned.split("?")[0].split("#")[0];
}

export function authGate(
  authenticate: (req: Request, res: Response, next: NextFunction) => void,
  opts?: GateOpts
) {
  // Graceful defaults
  const paths = opts?.publicGetPaths ?? [];
  const regexes = opts?.publicGetRegexes ?? [];

  return function (req: Request, res: Response, next: NextFunction) {
    // Build normalized path (without query), using originalUrl if available
    const pathOnly = sanitizePath(req.originalUrl || req.url || "");

    // Allow anonymous GETs that match either list
    if (
      req.method === "GET" &&
      (paths.includes(pathOnly) || regexes.some((rx) => rx.test(pathOnly)))
    ) {
      return next();
    }

    // Everything else requires auth
    return authenticate(req, res, next);
  };
}
