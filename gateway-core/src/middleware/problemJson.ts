// backend/services/gateway/src/middleware/problemJson.ts
import type { RequestHandler, ErrorRequestHandler } from "express";

// Adds res.problem(status, payload) helper; normal 2xx responses keep their JSON/content-type.
// Only error handlers set application/problem+json.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Response {
      problem?: (status: number, body: Record<string, any>) => void;
    }
  }
}

export const problemJsonMiddleware = (): RequestHandler => {
  return (_req, res, next) => {
    res.problem = (status: number, body: Record<string, any>) => {
      res.status(status);
      res.type("application/problem+json");
      res.json(body);
    };
    next();
  };
};

export const notFoundHandler = (): RequestHandler => {
  return (req, res) => {
    (res.problem ?? res.status.bind(res))(404, {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Route not found",
      instance: (req as any).id,
    });
  };
};

export const errorHandler = (): ErrorRequestHandler => {
  return (err, req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    (res.problem ?? res.status.bind(res))(
      Number.isFinite(status) ? status : 500,
      {
        type: err?.type || "about:blank",
        title: err?.title || "Internal Server Error",
        status: Number.isFinite(status) ? status : 500,
        detail: err?.message || "Unexpected error",
        instance: (req as any).id,
      }
    );
  };
};
