// backend/services/audit/src/routes/auditEvent.routes.ts
/**
 * Docs:
 * - Arch: docs/architecture/shared/ROUTE_CONVENTIONS.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 *
 * Why:
 * - Route one-liners only. Service exposes collection under /api; gateway adds slug.
 *   External (via gateway):  /api/audit/events
 *   Internal (service):      /api/events
 */

import { Router } from "express";
import ingest from "../handlers/auditEvent/ingest";
import getByEventId from "../handlers/auditEvent/getByEventId";
import list from "../handlers/auditEvent/list";

const router = Router();

// NOTE: no '/api' prefix here — app mounts this under '/api'
router.put("/events", ingest);
router.get("/events/:eventId", getByEventId);
router.get("/events", list);

export default router;
