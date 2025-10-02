// backend/services/user/src/controllers/AuthController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004
 *
 * Purpose:
 * - Minimal auth endpoints with uniform envelopes via SvcReceiver.
 * - No security/minting yet; returns deterministic mock payloads.
 */

import type { Request, Response } from "express";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";

export class UseController {
  private readonly rx = new SvcReceiver("auth");
}
