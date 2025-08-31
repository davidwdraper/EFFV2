// backend/services/gateway/src/middleware/problemJson.ts
import type { RequestHandler, ErrorRequestHandler } from "express";
import { logger } from "@shared/utils/logger";

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

function ridOf(req: any): string {
  return (
    req?.id ||
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-correlation-id"] ||
    req?.headers?.["x-amzn-trace-id"] ||
    ""
  );
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
    // <<<500DBG>>> log 5xx with trimmed stack before responding
    if (Number.isFinite(status) && status >= 500) {
      logger.debug(
        {
          sentinel: "500DBG",
          where: "errorHandler",
          rid: String(ridOf(req)),
          method: req.method,
          url: req.originalUrl,
          status,
          name: err?.name,
          message: err?.message,
          stack: String(err?.stack || "")
            .split("\n")
            .slice(0, 8),
        },
        "500 about to be sent <<<500DBG>>>"
      );
    }

    (res.problem ?? res.status.bind(res))(
      Number.isFinite(status) ? status : 500,
      {
        type: err?.type || "about:blank",
        title:
          err?.title || (status >= 500 ? "Internal Server Error" : "Error"),
        status: Number.isFinite(status) ? status : 500,
        detail: err?.message || "Unexpected error",
        instance: (req as any).id,
      }
    );
  };
};
