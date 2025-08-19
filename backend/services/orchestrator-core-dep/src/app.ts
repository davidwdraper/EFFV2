// src/app.ts
import express from "express";
import cors from "cors";
import coreCompositeRoutes from "./routes/compositeRoutes";
import userProxyRoutes from "./routes/userProxyRoutes";

const app = express();

// CORS setup
app.use(
  cors({
    origin: "*", // tighten in production if needed
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parser
app.use(express.json());

// Health check
app.get("/", (_req, res) => res.send("Orchestrator-core is up"));

// Composite routes
app.use("/users/composite", coreCompositeRoutes);

// Pure proxy routes — must forward ALL headers (including Authorization)
app.use("/users", userProxyRoutes);

export { app };
