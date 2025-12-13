// backend/services/prompt/src/routes/prompt.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire format)
 *   - ADR-0056 (Typed CRUD routes via :dtoType)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *
 * Purpose:
 * - Wire RESTful, versioned CRUD endpoints with explicit DTO type on every route.
 * - Adds a temporary compat alias for legacy prompt lookups:
 *   GET /:dtoType/readByKey?language=&version=&promptKey=
 *
 * Invariants:
 * - Router stays one-liner thin; no logic here.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { PromptCreateController } from "../controllers/create.controller/prompt.create.controller";
import { PromptReadController } from "../controllers/read.controller/prompt.read.controller";
import { PromptDeleteController } from "../controllers/delete.controller/prompt.delete.controller";
import { PromptUpdateController } from "../controllers/update.controller/prompt.update.controller";
import { PromptListController } from "../controllers/list.controller/prompt.list.controller";

export function buildPromptRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  const createCtl = new PromptCreateController(app);
  const updateCtl = new PromptUpdateController(app);
  const readCtl = new PromptReadController(app);
  const deleteCtl = new PromptDeleteController(app);
  const listCtl = new PromptListController(app);

  r.put("/:dtoType/create", (req, res) => createCtl.put(req, res));
  r.patch("/:dtoType/update/:id", (req, res) => updateCtl.patch(req, res));

  // Primary read by business key:
  r.get("/:dtoType/read/:language/:version/:promptKey", (req, res) =>
    readCtl.get(req, res)
  );

  // Compat alias for legacy callers (query-based):
  r.get("/:dtoType/readByKey", (req, res) => readCtl.getByKey(req, res));

  r.delete("/:dtoType/delete/:id", (req, res) => deleteCtl.delete(req, res));
  r.get("/:dtoType/list", (req, res) => listCtl.get(req, res));

  return r;
}
