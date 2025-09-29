// backend/services/gateway/src/controllers/HelloController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Return a friendly greeting for smoke and wiring validation.
 */

import { Request, Response } from "express";

export class HelloController {
  public getHello(_req: Request, res: Response): void {
    res.status(200).json({ message: "Hello" });
  }
}
