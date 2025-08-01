// routes/logRoutes.ts

import express from "express";
import { authenticate } from "@shared/middleware/authenticate";
import { dateNowIso } from "@shared/utils/dateUtils";
import Log from "../models/Log";
import { ILogFields } from "@shared/interfaces/Log/ILog";
//import { logger } from "@shared/utils/logger";

const router = express.Router();

/**
 * POST /logs — Create log (auth required)
 */
router.post("/", authenticate, async (req, res) => {
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

    // 🔐 Validation
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
    const userId = req.user?._id;

    // 🧪 Log what we're saving
    console.log("🪵 Creating log with payload:", {
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
  } catch (err) {
    console.error("[LogService] POST /logs failed", {
      error: err instanceof Error ? err.message : String(err),
      fullError: err,
      body: req.body,
      user: req.user,
    });

    res.status(500).send({ error: "Failed to create log" });
  }
});

export default router;
