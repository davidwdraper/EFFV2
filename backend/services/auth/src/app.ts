// src/app.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import { logger } from "@shared/utils/logger";

dotenv.config();

const app = express();

// Log environment setup
logger.debug("authService: Initializing app", {
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  PORT: process.env.PORT,
});

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);

// Root route for sanity check (optional)
app.get("/", (req, res) => {
  res.send("Auth service is up");
});

export default app;
