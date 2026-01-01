// backend/tools/dtoTestDataGen/nv-dto-gen.ts
/**
 * Docs:
 * - SOP: Helper tooling; deterministic output; fail-fast on drift.
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0089 (DTO Field DSL with Meta Envelope)
 *   - ADR-0090 (DTO Field DSL Design + Non-Breaking Integration)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *
 * Purpose:
 * - Entry point: generate a single `*.dto.tdata.ts` for one `*.dto.ts`.
 */

import { genMain } from "./src/genMain";

genMain(process.argv.slice(2));
