// routes/logRoutes.ts

import express from "express";
import { dateNowIso } from "@shared/utils/dateUtils";
import Log from "../models/Log";
import { ILogFields } from "@shared/interfaces/Log/ILog";
import { logger } from "@shared/utils/logger";

const router = express.Router();

/**
 * POST /logs — Create log (no auth required)
 */
router.post("/", async (req, res) => {
  try {
    if ("userId" in req.body) {
      return res.status(400).send({ error: "userId cannot be set manually" });
    }

    const {
      logType,
      logSeverity,
      message,
      path,
      entityId,
      entityName,
      service,
      sourceFile,
      sourceLine,
    } = req.body as Partial<ILogFields>;

    if (
      typeof logType !== "number" ||
      typeof logSeverity !== "number" ||
      typeof message !== "string"
    ) {
      return res.status(400).send({
        error: "logType, logSeverity, and message are required",
      });
    }

    const timeCreated = dateNowIso();
    const userId = (req as any).user?._id || undefined;

    const log = new Log({
      logType,
      logSeverity,
      message,
      path,
      entityId,
      entityName,
      service,
      sourceFile,
      sourceLine,
      userId,
      timeCreated,
    });

    await log.save();
    res.status(201).send(log.toObject());
  } catch (err: any) {
    console.warn("[logService] Failed to create log:", {
      error: err?.message || "unknown",
      fullError: err,
      requestBody: req.body,
    });

    res.status(500).send({ error: "Failed to create log" });
  }
});

export default router;
