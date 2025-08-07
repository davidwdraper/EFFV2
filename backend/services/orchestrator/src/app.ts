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
import townRoutes from "./routes/townRoutes"; // ✅ NEW

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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Parsers
app.use(express.json());

// ✅ Public health route BEFORE auth gate
app.get("/", (_req, res) => res.send("Orchestrator is up"));

// 🔒 Auth gate AFTER health, BEFORE other routes
// Allow anonymous GET/HEAD to /acts/search and /towns/typeahead (any prefix).
app.use(
  authGate(authenticate, {
    publicGetPaths: ["/"], // keep health public even if reordered
    publicGetRegexes: [
      /\/acts\/search$/, // e.g. /acts/search, /api/acts/search
      /\/towns\/typeahead$/, // e.g. /towns/typeahead, /v1/towns/typeahead
      // (optional legacy) keep these only if the frontend still calls them:
      // /\/acts\/hometowns$/,
      // /\/acts\/hometowns\/near$/,
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
app.use("/towns", townRoutes); // ✅ NEW

export default app;
