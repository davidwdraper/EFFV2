import { Request, Response, NextFunction } from "express";

type GateOpts = {
  /** Exact path matches (no querystring). Example: "/acts/hometowns" */
  publicGetPaths?: string[];
  /** Regex matchers for GET/HEAD paths */
  publicGetRegexes?: RegExp[];

  /** Exact path matches for POST requests */
  publicPostPaths?: string[];
  /** Regex matchers for POST paths */
  publicPostRegexes?: RegExp[];
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
  const getPaths = opts?.publicGetPaths ?? [];
  const getRegexes = opts?.publicGetRegexes ?? [];
  const postPaths = opts?.publicPostPaths ?? [];
  const postRegexes = opts?.publicPostRegexes ?? [];

  return function (req: Request, res: Response, next: NextFunction) {
    console.log("[gate]", req.method, req.originalUrl);

    const method = req.method.toUpperCase();

    // Always allow CORS preflight
    if (method === "OPTIONS") return res.sendStatus(204);

    // Build normalized path (without query), using originalUrl if available
    const pathOnly = sanitizePath(req.originalUrl || req.url || "");

    // HEAD treated as GET for public checks
    if (
      (method === "GET" || method === "HEAD") &&
      (getPaths.includes(pathOnly) ||
        getRegexes.some((rx) => rx.test(pathOnly)))
    ) {
      return next();
    }

    // Allow anonymous POSTs for whitelisted paths
    if (
      method === "POST" &&
      (postPaths.includes(pathOnly) ||
        postRegexes.some((rx) => rx.test(pathOnly)))
    ) {
      return next();
    }

    // Everything else requires auth
    return authenticate(req, res, next);
  };
}
