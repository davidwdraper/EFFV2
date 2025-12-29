// backend/services/test-runner/src/routes/test-runner.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Wire a versioned test-runner endpoint with explicit DTO type on the route.
 * - Paths are relative to /api/test-runner/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - `:dtoType` is a DtoRegistry key; controllers read it from req.params.dtoType.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { TestRunnerRunController } from "../controllers/run.controller/test-runner.run.controller";

export function buildTestRunnerRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const runCtl = new TestRunnerRunController(app);

  // RUN TEST (POST /:dtoType/run-test)
  r.post("/:dtoType/run-test", (req, res) => runCtl.post(req, res));

  return r;
}

/*
curl -i -X POST \
  "http://localhost:5010/api/test-runner/v1/test-runner/run-test" \
  -H "Content-Type: application/json" \
  -H "x-request-id: manual-test-runner-001"


*/