// backend/services/gateway/src/controllers/townProxyController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import axios from "axios";
import { requireUpstream } from "../config";

const ACT_URL = requireUpstream("ACT_SERVICE_URL");

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// GET /towns/typeahead?q=...&state=TX&limit=20
export const typeahead: RequestHandler = asyncHandler(async (req, res) => {
  const q = (req.query.q ?? req.query.query ?? "").toString();
  const state = (req.query.state ?? "").toString();
  const limit = Number(req.query.limit ?? 10);

  const out = await axios.get(`${ACT_URL}/towns`, {
    timeout: 2500,
    headers: {
      "x-request-id": (req as any).id || req.headers["x-request-id"] || "",
    },
    params: {
      query: q, // map q -> query (Act service expects `query`)
      state,
      limit,
    },
  });

  res.status(out.status).json(out.data);
});

// GET /towns?query=...&state=TX&limit=20  (generic pass-through)
export const list: RequestHandler = asyncHandler(async (req, res) => {
  const out = await axios.get(`${ACT_URL}/towns`, {
    timeout: 2500,
    headers: {
      "x-request-id": (req as any).id || req.headers["x-request-id"] || "",
    },
    params: req.query,
  });
  res.status(out.status).json(out.data);
});

// GET /towns/:id  (pass-through to Act)
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const out = await axios.get(`${ACT_URL}/towns/${req.params.id}`, {
    timeout: 2500,
    headers: {
      "x-request-id": (req as any).id || req.headers["x-request-id"] || "",
    },
  });
  res.status(out.status).json(out.data);
});
