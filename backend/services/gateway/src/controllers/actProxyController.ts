// backend/services/gateway/src/controllers/actProxyController.ts
import type { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { requireUpstream } from "../config";
import { withTrace, getRequestId } from "../../../shared/trace";

const ACT_SERVICE_URL = requireUpstream("ACT_SERVICE_URL");

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

const toUpstream = (req: Request) =>
  `${ACT_SERVICE_URL.replace(/\/$/, "")}${req.originalUrl}`;

const commonHeaders = (req: any, res: any) => ({
  ...req.headers,
  host: undefined as any,
  "x-request-id": getRequestId(req, res),
});

/** GET /acts */
export const list = withTrace(
  "gateway: GET /acts (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.get(toUpstream(req), {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to list acts");
    }
  }
);

/** GET /acts/search */
export const search = withTrace(
  "gateway: GET /acts/search (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.get(toUpstream(req), {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to search acts");
    }
  }
);

/** GET /acts/by-hometown */
export const byHometown = withTrace(
  "gateway: GET /acts/by-hometown (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.get(toUpstream(req), {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to search acts by hometown");
    }
  }
);

/** GET /acts/:id */
export const getById = withTrace(
  "gateway: GET /acts/:id (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.get(toUpstream(req), {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to fetch act");
    }
  }
);

/** POST /acts */
export const create = withTrace(
  "gateway: POST /acts (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.post(toUpstream(req), req.body, {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to create act");
    }
  }
);

/** PUT /acts/:id */
export const update = withTrace(
  "gateway: PUT /acts/:id (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.put(toUpstream(req), req.body, {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to update act");
    }
  }
);

/** DELETE /acts/:id */
export const remove = withTrace(
  "gateway: DELETE /acts/:id (proxy→act)",
  async (req, res) => {
    try {
      const r = await axios.delete(toUpstream(req), {
        headers: commonHeaders(req, res),
        validateStatus: () => true,
      });
      return res
        .status(r.status)
        .set(sanitizeResponseHeaders(r.headers as any))
        .send(r.data);
    } catch (err) {
      return passThroughError(res, err, "Failed to delete act");
    }
  }
);
