// backend/services/user/src/controllers/userController.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import {
  zUserCreate,
  zUserPatch,
  zUserReplace,
} from "../contracts/userContracts";
import * as svc from "../services/userService";

// POST /users
export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zUserCreate.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Missing or invalid fields" });
  }
  const out = await svc.createUser(parsed.data);
  if ("conflict" in out)
    return res.status(409).json({ error: "User already exists" });

  req.audit?.push({
    type: "create",
    model: "User",
    id: String((out as any).doc?._id),
    email: (out as any).doc?.email,
  });

  return res.status(201).json(out.dto);
});

// GET /users
export const list: RequestHandler = asyncHandler(async (_req, res) => {
  const dtos = await svc.listUsers();
  return res.status(200).json(dtos);
});

// GET /users/:id
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const out = await svc.getUserById(String(req.params.id));
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  return res.status(200).json(out.dto);
});

// PUT /users/:id
export const replaceUser: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zUserReplace.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Missing required fields: email, firstname, lastname" });
  }
  const out = await svc.replaceUser(String(req.params.id), parsed.data);
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  if ("conflict" in out)
    return res.status(409).json({ error: "User already exists" });

  req.audit?.push({
    type: "replace",
    model: "User",
    id: String(req.params.id),
  });
  return res.status(200).json(out.dto);
});

// PATCH /users/:id
export const patchUser: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zUserPatch.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid patch" });

  const out = await svc.patchUser(String(req.params.id), parsed.data);
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  if ("conflict" in out)
    return res.status(409).json({ error: "User already exists" });

  req.audit?.push({
    type: "patch",
    model: "User",
    id: String(req.params.id),
    fields: Object.keys(parsed.data ?? {}),
  });
  return res.status(200).json(out.dto);
});

// DELETE /users/:id
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const out = await svc.removeUser(String(req.params.id));
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });

  req.audit?.push({ type: "delete", model: "User", id: String(req.params.id) });
  return res.status(200).json({ success: true });
});

// GET /users/private/email/:email
export const getUserByEmailWithPassword: RequestHandler = asyncHandler(
  async (req, res) => {
    const out = await svc.getUserByEmailWithPassword(String(req.params.email));
    if ("notFound" in out)
      return res.status(404).json({ error: "User not found" });
    return res.status(200).json(out.dto);
  }
);

// GET /users/email/:email
export const getUserByEmail: RequestHandler = asyncHandler(async (req, res) => {
  const out = await svc.getUserByEmail(String(req.params.email));
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  return res.status(200).json(out.dto);
});

// Back-compat names
export const update = replaceUser;
export const patch = patchUser;
