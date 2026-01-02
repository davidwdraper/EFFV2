// /Users/ddraper005/eff/backend/services/shared/src/dto/user.dto.tdata.ts
/**
 * Docs:
 * - SOP: Deterministic test fixtures; sidecar is happy-only; variants minted downstream.
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *   - ADR-0092 (DTO Fields DSL + Testdata Generation)
 *
 * Source DTO:
 * - backend/services/shared/src/dto/user.dto.ts
 *
 * Invariants:
 * - getJson() returns DATA ONLY (canonical DTO JSON). No meta envelope.
 * - getHints() returns minimal mutation hints for test tooling (uniquify/missing/etc).
 * - Generated file. Edit DTO Fields DSL, then re-generate.
 */

export class UserDtoTdata {
  public static getJson(): unknown {
    return {
  "type": "user",
  "givenName": "Abcdef",
  "lastName": "Abcdef",
  "email": "xxxx+xxxx@xxx.xxx",
  "homeLat": 37.7749,
  "homeLng": -122.4194,
  "address1": "t_address1",
  "address2": "t_address2",
  "city": "t_city",
  "state": "CA",
  "pcode": "12345",
  "notes": "t_notes"
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
    "givenName": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "minLen": 1,
      "maxLen": 80,
      "alpha": true,
      "case": "capitalized"
    },
    "lastName": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "minLen": 1,
      "maxLen": 80,
      "alpha": true,
      "case": "capitalized"
    },
    "email": {
      "kind": "string",
      "required": true,
      "presentByDefault": true,
      "unique": true,
      "format": "email",
      "minLen": 5,
      "maxLen": 200
    },
    "phone": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "unique": true,
      "format": "phoneDigits"
    },
    "homeLat": {
      "kind": "number",
      "required": false,
      "presentByDefault": false,
      "format": "lat"
    },
    "homeLng": {
      "kind": "number",
      "required": false,
      "presentByDefault": false,
      "format": "lng"
    },
    "address1": {
      "kind": "string",
      "required": false,
      "presentByDefault": false
    },
    "address2": {
      "kind": "string",
      "required": false,
      "presentByDefault": false
    },
    "city": {
      "kind": "string",
      "required": false,
      "presentByDefault": false
    },
    "state": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "format": "state2"
    },
    "pcode": {
      "kind": "string",
      "required": false,
      "presentByDefault": false,
      "format": "zip5"
    },
    "notes": {
      "kind": "string",
      "required": false,
      "presentByDefault": false
    }
  }
};
  }
}
