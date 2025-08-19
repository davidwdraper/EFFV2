// backend/services/gateway/src/controllers/userProxyController.ts

import type { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { requireUpstream } from "../config";
import { withTrace, getRequestId } from "../../../shared/trace"; // <-- fixed path

const USER_SERVICE_URL = requireUpstream("USER_SERVICE_URL");

function sanitizeResponseHeaders(headers: Record<string, string> = {}) {
  const {
    connection,
    "transfer-encoding": te,
    "content-length": cl,
    "keep-alive": ka,
    "proxy-authenticate": pa,
    "proxy-authorization": pz,
    te: te2,
    upgrade,
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
  if (ax && ax.response) {
    const { status, headers, data } = ax.response;
    return res
      .status(status)
      .set(sanitizeResponseHeaders(headers as any))
      .send(data);
  }
  const code = (ax && ax.code) || "";
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

function toUpstreamUser(body: any) {
  if (body && typeof body === "object") {
    const { email, ...rest } = body;
    const mapped: any = { ...rest };
    if (email != null && rest.eMailAddr == null) mapped.eMailAddr = email;
    return mapped;
  }
  return body;
}

function toExternalUser(data: any) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.eMailAddr != null && data.email == null) {
      return { ...data, email: data.eMailAddr };
    }
  }
  return data;
}

export const create = withTrace(
  "gateway: POST /users (proxy→user, email→eMailAddr)",
  async (req: Request, res: Response) => {
    const url = `${USER_SERVICE_URL.replace(/\/$/, "")}/users`;
    const requestId = getRequestId(req, res);
    const payload = toUpstreamUser(req.body);

    try {
      const response = await axios.post(url, payload, {
        headers: {
          ...req.headers,
          host: undefined as any,
          "x-request-id": requestId,
        },
        validateStatus: () => true,
      });
      const data = toExternalUser(response.data);
      return res
        .status(response.status)
        .set(sanitizeResponseHeaders(response.headers as any))
        .send(data);
    } catch (err) {
      return passThroughError(res, err, "Failed to create user");
    }
  }
);

export const getByEmail = withTrace(
  "gateway: GET /users/private/email (proxy→user, email param)",
  async (req: Request, res: Response) => {
    const requestId = getRequestId(req, res);
    const targetUrl = `${USER_SERVICE_URL.replace(
      /\/$/,
      ""
    )}/users/private/email/${encodeURIComponent(req.params.email)}`;

    try {
      const response = await axios.get(targetUrl, {
        headers: {
          ...req.headers,
          host: undefined as any,
          "x-request-id": requestId,
        },
        validateStatus: () => true,
      });
      const data = toExternalUser(response.data);
      return res
        .status(response.status)
        .set(sanitizeResponseHeaders(response.headers as any))
        .send(data);
    } catch (err) {
      return passThroughError(res, err, "Failed to fetch user by email");
    }
  }
);
