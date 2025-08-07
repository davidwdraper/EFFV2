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
  let path = cleaned.split("?")[0].split("#")[0];

  // normalize trailing slash (except root "/")
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  return path;
}

export function authGate(
  authenticate: (req: Request, res: Response, next: NextFunction) => void,
  opts?: GateOpts
) {
  // Graceful defaults
  const paths = opts?.publicGetPaths ?? [];
  const regexes = opts?.publicGetRegexes ?? [];

  return function (req: Request, res: Response, next: NextFunction) {
    console.log("[gate]", req.method, req.originalUrl);

    const method = req.method.toUpperCase();

    // Always allow CORS preflight
    if (method === "OPTIONS") return res.sendStatus(204);

    // Build normalized path (without query), using originalUrl if available
    const pathOnly = sanitizePath(req.originalUrl || req.url || "");

    // Treat HEAD like GET for public route checks
    const isReadable = method === "GET" || method === "HEAD";

    // Allow anonymous GET/HEADs that match either list
    if (
      isReadable &&
      (paths.includes(pathOnly) || regexes.some((rx) => rx.test(pathOnly)))
    ) {
      return next();
    }

    // Everything else requires auth
    return authenticate(req, res, next);
  };
}
