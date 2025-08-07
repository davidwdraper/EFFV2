// src/app.ts
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
import imageRoutes from "./routes/imageRoutes";
import logRoutes from "./routes/logRoutes";

dotenv.config();
const app = express();

logger.debug("orchestrator: app.ts initializing", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
});

// CORS
app.use(
  cors({
    origin: "*", // tighten in production
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Parsers
app.use(express.json());

// ✅ Public health route BEFORE auth gate
app.get("/", (_req, res) => res.send("Orchestrator is up"));

// 🔒 Auth gate AFTER health, BEFORE other routes
app.use(
  authGate(authenticate, {
    publicGetPaths: [
      "/acts/hometowns",
      "/acts/hometowns/near",
      // "/acts", // uncomment if you want list-acts public
      "/", // health stays public even if moved later
    ],
  })
);

// Routes
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/acts", actRoutes);
app.use("/events", eventRoutes);
app.use("/places", placeRoutes);
app.use("/logs", logRoutes);
app.use("/images", imageRoutes);

export default app;
