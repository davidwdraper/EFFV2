// backend/services/user/src/controllers/handlers/remove.ts
import type { RequestHandler } from "express";
import * as svc from "../../services/user.service";

export const remove: RequestHandler = async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    const ok = await svc.removeUser(id);
    if (!ok) {
      return res.status(404).json({
        code: "NOT_FOUND",
        status: 404,
        message: "User not found",
      });
    }
    return res.status(204).end(); // No Content
  } catch (err) {
    next(err);
  }
};

export default remove;
