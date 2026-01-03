// backend/services/shared/src/testing/createTestScenarioStatus.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose (single concern):
 * - Centralize TestScenarioStatus construction so tests don’t duplicate seeding logic.
 *
 * Invariants:
 * - One scenario => one TestScenarioStatus instance.
 * - No ALS, no expectErrors, no “clever” inference.
 */

import type { TestExpectedMode, TestScenarioId } from "./TestScenarioStatus";
import { TestScenarioStatus } from "./TestScenarioStatus";

export function createTestScenarioStatus(input: {
  scenarioId: TestScenarioId;
  scenarioName: string;
  expected: TestExpectedMode;
}): TestScenarioStatus {
  return new TestScenarioStatus({
    scenarioId: input.scenarioId,
    scenarioName: input.scenarioName,
    expected: input.expected,
  });
}
