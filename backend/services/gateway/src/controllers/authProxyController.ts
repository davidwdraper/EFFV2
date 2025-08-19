// backend/services/gateway/src/controllers/authProxyController.ts
import type { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { requireUpstream } from "../config";
import { withTrace, getRequestId } from "../../../shared/trace";

const AUTH_SERVICE_URL = requireUpstream("AUTH_SERVICE_URL"); // e.g., http://localhost:4007

function sanitizeResponseHeaders(headers: Record<string, string> = {}) {
  const {
    connection,
    "transfer-encoding": _te,
    "content-length": _cl,
    "keep-alive": _ka,
    "proxy-authenticate": _pa,
    "proxy-authorization": _pz,
    te: _te2,
    upgrade: _upgrade,
    ...safe
  } = headers as any;
  return safe as Record<string, string>;
}

function passThroughError(
  res: Response,
  err: unknown,
  fallbackMessage: string
) {
  const ax = err as AxiosError;

  if (ax?.response) {
    const { status, headers, data } = ax.response;
    return res
      .status(status)
      .set(sanitizeResponseHeaders(headers as any))
      .send(data);
  }

  const code = ax?.code || "";
  const msg = (ax as any)?.message || "Upstream error";
  const timeout =
    code === "ECONNABORTED" ||
    (typeof (ax as any)?.message === "string" &&
      (ax as any).message.toLowerCase().includes("timeout"));
  const connErr =
    code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH";
  const status = timeout ? 504 : connErr ? 502 : 500;

  return res.status(status).json({ error: fallbackMessage, detail: msg, code });
}

// Preserve /auth prefix so upstream sees the exact same path
const toUpstream = (req: Request) =>
  `${AUTH_SERVICE_URL.replace(/\/$/, "")}${req.originalUrl}`;

/** POST /auth/create */
export const create = withTrace(
  "gateway: POST /auth/create (proxy→auth)",
  async (req: Request, res: Response) => {
    const requestId = getRequestId(req, res);
    try {
      const response = await axios.post(toUpstream(req), req.body, {
        headers: {
          ...req.headers,
          host: undefined as any,
          "x-request-id": requestId,
        },
        validateStatus: () => true,
      });
      return res
        .status(response.status)
        .set(sanitizeResponseHeaders(response.headers as any))
        .send(response.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to create user");
    }
  }
);

/** POST /auth/login */
export const login = withTrace(
  "gateway: POST /auth/login (proxy→auth)",
  async (req: Request, res: Response) => {
    const requestId = getRequestId(req, res);
    try {
      const response = await axios.post(toUpstream(req), req.body, {
        headers: {
          ...req.headers,
          host: undefined as any,
          "x-request-id": requestId,
        },
        validateStatus: () => true,
      });
      return res
        .status(response.status)
        .set(sanitizeResponseHeaders(response.headers as any))
        .send(response.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to login");
    }
  }
);

/** POST /auth/password_reset */
export const passwordReset = withTrace(
  "gateway: POST /auth/password_reset (proxy→auth)",
  async (req: Request, res: Response) => {
    const requestId = getRequestId(req, res);
    try {
      const response = await axios.post(toUpstream(req), req.body, {
        headers: {
          ...req.headers,
          host: undefined as any,
          "x-request-id": requestId,
        },
        validateStatus: () => true,
      });
      return res
        .status(response.status)
        .set(sanitizeResponseHeaders(response.headers as any))
        .send(response.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to reset password");
    }
  }
);
