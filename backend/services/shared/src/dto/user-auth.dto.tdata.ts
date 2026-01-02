// /Users/ddraper005/eff/backend/services/shared/src/dto/user-auth.dto.tdata.ts
/**
 * Docs:
 * - SOP: Deterministic test fixtures; sidecar is happy-only; variants minted downstream.
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *   - ADR-0092 (DTO Fields DSL + Testdata Generation)
 *
 * Source DTO:
 * - backend/services/shared/src/dto/user-auth.dto.ts
 *
 * Invariants:
 * - getJson() returns DATA ONLY (canonical DTO JSON). No meta envelope.
 * - getHints() returns minimal mutation hints for test tooling (uniquify/missing/etc).
 * - Generated file. Edit DTO Fields DSL, then re-generate.
 */

export class UserAuthDtoTdata {
  public static getJson(): unknown {
    return {
  "type": "user-auth",
  "userId": "t_userId",
  "hash": "t_hash",
  "hashAlgo": "t_hashAlgo",
  "hashParamsJson": "{}",
  "failedAttemptCount": 0,
  "lastFailedAt": "2020-01-02T03:04:05.678Z",
  "lockedUntil": "2020-01-02T03:04:05.678Z",
  "passwordCreatedAt": "2020-01-02T03:04:05.678Z",
  "passwordUpdatedAt": "2020-01-02T03:04:05.678Z"
};
  }

  public static getHints(): unknown {
    return {
  "fields": {
    "type": {
      "kind": "literal",
      "required": false,
      "presentByDefault": true
    },
    "userId": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "minLen": 1,
      "maxLen": 80
    },
    "hash": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "minLen": 1,
      "maxLen": 4000
    },
    "hashAlgo": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "minLen": 2,
      "maxLen": 40
    },
    "hashParamsJson": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "format": "json",
      "maxLen": 8000
    },
    "failedAttemptCount": {
      "kind": "number",
      "required": true,
      "presentByDefault": true,
      "min": 0,
      "max": 999999
    },
    "lastFailedAt": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "format": "isoTime"
    },
    "lockedUntil": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "format": "isoTime"
    },
    "passwordCreatedAt": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "format": "isoTime"
    },
    "passwordUpdatedAt": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "format": "isoTime"
    }
  }
};
  }
}
