// backend/services/gateway/src/routes/authRoutes.ts
import { Router } from "express";
import * as C from "../controllers/authProxyController";

const r = Router();

// One-liners only; paths mirror the auth service exactly
r.post("/create", C.create); // POST /auth/create
r.post("/login", C.login); // POST /auth/login
r.post("/password_reset", C.passwordReset); // POST /auth/password_reset

export default r;
