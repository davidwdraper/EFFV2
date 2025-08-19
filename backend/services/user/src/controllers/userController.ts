// backend/services/user/src/controllers/userController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import UserModel from "../models/User";

// Small async wrapper to keep routes one-liners and centralize try/catch
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Helpers
const required = (v: any) =>
  v !== undefined && v !== null && String(v).trim() !== "";
const sanitize = (doc: any) => {
  if (!doc) return doc;
  const { password, __v, _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return { id: String(doc._id ?? _id), ...rest };
};

// ---------- Handlers ----------

// POST /users  (public signup)
export const create: RequestHandler = asyncHandler(async (req, res) => {
  const { email, password, firstname, lastname, middlename } = req.body ?? {};

  if (
    !required(email) ||
    !required(password) ||
    !required(firstname) ||
    !required(lastname)
  ) {
    req.log?.debug(
      {
        email: !!email,
        password: !!password,
        firstname: !!firstname,
        lastname: !!lastname,
      },
      "users:create missing fields"
    );
    return res.status(400).json({ error: "Missing required user fields" });
  }

  const existing = await UserModel.findOne({
    email: String(email).toLowerCase(),
  }).lean();
  if (existing) {
    req.log?.debug({ email }, "users:create conflict (email exists)");
    return res.status(409).json({ error: "User already exists" });
  }

  const now = new Date();
  const doc = await UserModel.create({
    email: String(email).toLowerCase(),
    password, // hashing to be handled by model hook or auth flow; not returned
    firstname,
    lastname,
    middlename,
    dateCreated: now,
    dateLastUpdated: now,
    userStatus: 0,
    userType: 0,
    imageIds: [],
  });

  // Audit
  req.audit?.push({
    type: "create",
    model: "User",
    id: String(doc._id),
    email: doc.email,
  });

  req.log?.info({ userId: String(doc._id) }, "users:create success");
  return res.status(201).json(sanitize(doc));
});

// GET /users  (public list)
export const list: RequestHandler = asyncHandler(async (_req, res) => {
  const users = await UserModel.find().lean();
  return res.status(200).json(users.map((u) => sanitize(u)));
});

// GET /users/:id
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await UserModel.findById(id).lean();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.status(200).json(sanitize(user));
});

// PUT /users/:id  (protected)
export const update: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const patch = { ...req.body, dateLastUpdated: new Date() };

  // Optional: enforce canonical email casing if provided
  if (patch.email) patch.email = String(patch.email).toLowerCase();

  const user = await UserModel.findByIdAndUpdate(id, patch, {
    new: true,
  }).lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  // Audit
  req.audit?.push({
    type: "update",
    model: "User",
    id,
    fields: Object.keys(patch),
  });

  return res.status(200).json(sanitize(user));
});

// DELETE /users/:id  (protected)
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await UserModel.findByIdAndDelete(id).lean();
  if (!result) return res.status(404).json({ error: "User not found" });

  // Audit
  req.audit?.push({ type: "delete", model: "User", id });

  return res.status(200).json({ success: true });
});

// GET /users/private/email/:email  (internal helper returning password hash)
export const getUserByEmailWithPassword: RequestHandler = asyncHandler(
  async (req, res) => {
    const { email } = req.params;
    if (!required(email))
      return res.status(400).json({ error: "email required" });

    // Include password for auth service; DO NOT expose this endpoint publicly
    const user = await UserModel.findOne({
      email: String(email).toLowerCase(),
    }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // No sanitize here—auth service expects password/hash
    return res.status(200).json({
      id: String(user._id),
      email: user.email,
      password: user.password,
      firstname: user.firstname,
      middlename: user.middlename,
      lastname: user.lastname,
      userStatus: user.userStatus,
      userType: user.userType,
    });
  }
);

// GET /users/email/:email (no password)
export const getUserByEmail: RequestHandler = asyncHandler(async (req, res) => {
  const { email } = req.params;
  if (!required(email))
    return res.status(400).json({ error: "email required" });

  const user = await UserModel.findOne({
    email: String(email).toLowerCase(),
  }).lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.status(200).json(sanitize(user));
});
