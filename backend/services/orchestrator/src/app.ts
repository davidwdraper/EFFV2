// src/app.ts
import express from "express";
import dotenv from "dotenv";
import { logger } from "@shared/utils/logger";

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

app.use(express.json());

// Routes
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/acts", actRoutes);
app.use("/events", eventRoutes);
app.use("/places", placeRoutes);
app.use("/logs", logRoutes);
app.use("/images", imageRoutes);

// Optional sanity check
app.get("/", (req, res) => {
  res.send("Orchestrator is up");
});

export default app;
