// backend/services/gateway/src/middleware/trace5xx.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";

function ridOf(req: Request) {
  const hdr =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-amzn-trace-id"] as string | undefined);
  return (req as any).id || hdr || "";
}

function filteredStack(err: Error) {
  const raw = String(err.stack || "").split("\n");
  // keep only frames from your repo (drop node internals / node_modules noise)
  return raw.filter(
    (l) =>
      l.includes("/backend/services/gateway/") && !l.includes("/node_modules/")
  );
}

export function trace5xx(tag = "trace5xx") {
  return (req: Request, res: Response, next: NextFunction) => {
    const rid = String(ridOf(req));
    let firstSetter: { code: number; phase: string; stack: string[] } | null =
      null;

    const _status = res.status.bind(res);
    res.status = (code: number) => {
      if (code >= 500 && !firstSetter) {
        firstSetter = {
          code,
          phase: "res.status()",
          stack: filteredStack(new Error("trace5xx")),
        };
        logger.debug(
          {
            sentinel: "500DBG",
            tag,
            rid,
            method: req.method,
            url: req.originalUrl,
            phase: firstSetter.phase,
            code,
            stack: firstSetter.stack,
          },
          "500 set here <<<500DBG>>>"
        );
      }
      return _status(code);
    };

    const _sendStatus = res.sendStatus?.bind(res);
    if (_sendStatus) {
      res.sendStatus = (code: number) => {
        if (code >= 500 && !firstSetter) {
          firstSetter = {
            code,
            phase: "res.sendStatus()",
            stack: filteredStack(new Error("trace5xx")),
          };
          logger.debug(
            {
              sentinel: "500DBG",
              tag,
              rid,
              method: req.method,
              url: req.originalUrl,
              phase: firstSetter.phase,
              code,
              stack: firstSetter.stack,
            },
            "500 set here <<<500DBG>>>"
          );
        }
        return _sendStatus(code);
      };
    }

    const _writeHead = (res as any).writeHead?.bind(res);
    if (_writeHead) {
      (res as any).writeHead = (code: number, ...rest: any[]) => {
        if (code >= 500 && !firstSetter) {
          firstSetter = {
            code,
            phase: "res.writeHead()",
            stack: filteredStack(new Error("trace5xx")),
          };
          logger.debug(
            {
              sentinel: "500DBG",
              tag,
              rid,
              method: req.method,
              url: req.originalUrl,
              phase: firstSetter.phase,
              code,
              stack: firstSetter.stack,
            },
            "500 set here <<<500DBG>>>"
          );
        }
        return _writeHead(code, ...rest);
      };
    }

    res.on("finish", () => {
      if (res.statusCode >= 500) {
        logger.debug(
          {
            sentinel: "500DBG",
            tag,
            rid,
            method: req.method,
            url: req.originalUrl,
            phase: firstSetter?.phase || "unknown",
            code: res.statusCode,
            stack: firstSetter?.stack,
          },
          "response finished 5xx <<<500DBG>>>"
        );
      }
    });

    next();
  };
}
