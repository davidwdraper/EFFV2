// orchestrator/src/utils/proxyHelper.ts
import axios from "axios";
import { Request, Response } from "express";
import { logger } from "@shared/utils/logger";

/**
 * Proxies an incoming request to a target service URL.
 * Forwards method, headers (selectively), and body if applicable.
 */
export async function proxyRequest(
  req: Request,
  res: Response,
  serviceUrl: string
) {
  const targetUrl = `${serviceUrl}${req.originalUrl}`;
  const method = req.method.toUpperCase();

  logger.debug("orchestrator: proxyRequest called", {
    method,
    targetUrl,
    hasBody: ["POST", "PUT", "PATCH"].includes(method),
    headers: {
      hasAuthorization: Boolean(req.headers.authorization),
      hasCookie: Boolean(req.headers.cookie),
    },
  });

  try {
    const { authorization, cookie } = req.headers;
    const headers: Record<string, any> = {
      authorization,
      cookie,
      "Content-Type": "application/json",
    };

    const response = await axios({
      method,
      url: targetUrl,
      headers,
      data: ["POST", "PUT", "PATCH"].includes(method) ? req.body : undefined,
      timeout: 5000,
    });

    res.status(response.status).set(response.headers).send(response.data);
  } catch (err: any) {
    const status = err.response?.status || 500;
    const message = err.message || "Unknown error";

    logger.error("orchestrator: proxyRequest failed", {
      method,
      targetUrl,
      status,
      message,
      responseData: err.response?.data,
    });

    if (err.response?.data) {
      res.status(status).send(err.response.data);
    } else {
      res.status(status).json({ error: message });
    }
  }
}
