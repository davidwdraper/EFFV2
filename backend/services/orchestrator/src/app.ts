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

// ✅ NEW: entity images (GET /acts/:id/images)
import actImageRoutes from "./routes/actRoutes.images";

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

// 🔒 Auth gate AFTER health
app.use(
  authGate(authenticate, {
    publicGetPaths: ["/"], // health check remains public
    publicGetRegexes: [
      /\/acts\/search$/, // e.g. /acts/search
      /\/towns\/typeahead$/, // e.g. /towns/typeahead
      /\/acts\/[^/]+\/images$/, // ✅ allow viewing entity images
      /\/images\/[^/]+\/data$/, // ✅ raw image bytes
      /\/images\/[^/]+$/, // ✅ image metadata DTO
    ],
    publicPostPaths: ["/auth/login", "/auth/signup"],
    // If you want the client to batch image DTOs directly, also open this:
    // publicPostRegexes: [/^\/images\/lookup$/],
  })
);

// Routes
app.use("/auth", authRoutes);
app.use("/users", userRoutes);

// Mount /acts routes first, then the images sub-route (paths don't overlap)
app.use("/acts", actRoutes);
app.use("/acts", actImageRoutes); // ✅ exposes GET /acts/:id/images

app.use("/events", eventRoutes);
app.use("/places", placeRoutes);
app.use("/logs", logRoutes);
app.use("/images", imageRoutes);
app.use("/towns", townRoutes); // ✅ NEW

export default app;
