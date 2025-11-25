// backend/services/prompt/src/routes/prompt.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>) — extended to ALL CRUD routes via :dtoType
 *   - ADR-0064 (Prompts Service, PromptsClient, Prompt-Flush MOS, UI Text Catalog)
 *
 * Purpose:
 * - Wire RESTful, versioned CRUD endpoints with explicit DTO type on every route.
 * - Paths are relative to /api/prompt/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - Canonical DELETE id param is `:id`.
 * - `:dtoType` is a DtoRegistry key; controllers read it from req.params.dtoType and store in ControllerBase.
 * - For the prompt service, the primary READ path uses the business key:
 *   (language, version, promptKey) instead of the opaque `_id`.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { PromptCreateController } from "../controllers/create.controller/prompt.create.controller";
import { PromptReadController } from "../controllers/read.controller/prompt.read.controller";
import { PromptDeleteController } from "../controllers/delete.controller/prompt.delete.controller";
import { PromptUpdateController } from "../controllers/update.controller/prompt.update.controller";
import { PromptListController } from "../controllers/list.controller/prompt.list.controller";

export function buildPromptRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const createCtl = new PromptCreateController(app);
  const updateCtl = new PromptUpdateController(app);
  const readCtl = new PromptReadController(app);
  const deleteCtl = new PromptDeleteController(app);
  const listCtl = new PromptListController(app);

  // CREATE (PUT /:dtoType/create)
  r.put("/:dtoType/create", (req, res) => createCtl.put(req, res));

  // UPDATE (PATCH /:dtoType/update/:id)
  r.patch("/:dtoType/update/:id", (req, res) => updateCtl.patch(req, res));

  /**
   * READ by business key (GET /:dtoType/read/:language/:version/:promptKey)
   *
   * Example:
   *   GET /api/prompt/v1/prompt/read/en-US/1/auth.password.too-weak
   *
   * Controller is responsible for:
   * - Reading dtoType from params.dtoType
   * - Reading language, version, promptKey from params
   * - Building a filter on (promptKey, language, version)
   */
  r.get("/:dtoType/read/:language/:version/:promptKey", (req, res) =>
    readCtl.get(req, res)
  );

  // DELETE (DELETE /:dtoType/delete/:id) — canonical only
  r.delete("/:dtoType/delete/:id", (req, res) => deleteCtl.delete(req, res));

  // LIST (GET /:dtoType/list) — pagination via query (?limit=&cursor=…)
  r.get("/:dtoType/list", (req, res) => listCtl.get(req, res));

  return r;
}
