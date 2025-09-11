// backend/services/shared/middleware/core.ts
import express from "express";
import cors from "cors";

export function coreMiddleware() {
  return [
    cors({ origin: true, credentials: true }),
    express.json({ limit: "2mb" }),
    express.urlencoded({ extended: true }),
  ];
}
