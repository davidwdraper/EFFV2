import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { logger } from "@shared/utils/logger";
import { authenticate } from "@shared/middleware/authenticate";
import { authGate } from "./middleware/authGate";

import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import actRoutes from "./routes/actRoutes";
import eventRoutes from "./routes/eventRoutes";
import placeRoutes from "./routes/placeRoutes";
import imageRoutes from "./routes/imageRoutes"; // ✅ no alias import
import logRoutes from "./routes/logRoutes";
import townRoutes from "./routes/townRoutes";
import actImageRoutes from "./routes/actRoutes.images";

dotenv.config();
const app = express();

logger.debug("orchestrator: app.ts initializing", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  SVC_IMAGE_BASE: process.env.SVC_IMAGE_BASE,
  PUBLIC_API_BASE: process.env.PUBLIC_API_BASE,
});

// CORS
app.use(
  cors({
    origin: "*", // tighten in production
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"], // include Accept
  })
);

// Parsers
app.use(express.json());

// Public health BEFORE auth
app.get("/", (_req, res) => res.send("Orchestrator is up"));

// Public images ping BEFORE auth and BEFORE /images mount
app.get("/images/ping", (_req, res) =>
  res.json({ ok: true, where: "orchestrator-app" })
);

// 🔒 Auth gate AFTER health + ping
app.use(
  authGate(authenticate, {
    publicGetPaths: ["/"],
    publicGetRegexes: [
      /\/acts\/search$/,
      /\/towns\/typeahead$/,
      /\/acts\/[^/]+\/images$/,
      /\/images\/[^/]+\/data$/,
      /\/images\/[^/]+$/,
    ],
    publicPostPaths: ["/auth/login", "/auth/signup"],
    publicPostRegexes: [/^\/images\/lookup$/], // ✅ add this
  })
);

// Routes (behind auth unless whitelisted)
app.use("/auth", authRoutes);
app.use("/users", userRoutes);

// Acts then entity images
app.use("/acts", actRoutes);
app.use("/acts", actImageRoutes);

app.use("/events", eventRoutes);
app.use("/places", placeRoutes);
app.use("/logs", logRoutes);

// ✅ Single mount for images (no /image alias)
app.get("/images/ping", (_req, res) =>
  res.json({ ok: true, where: "orchestrator-app" })
);
app.use("/images", imageRoutes);

app.use("/towns", townRoutes);

export default app;
