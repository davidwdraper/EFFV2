// backend/tools/dtoTestDataGen/nv-dto-scan.ts
/**
 * Docs:
 * - SOP: Helper tooling; deterministic output; pipe-friendly.
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *
 * Purpose:
 * - Entry point: scan for `*.dto.ts` files.
 */

import { scanMain } from "./src/scanMain";

scanMain(process.argv.slice(2));
