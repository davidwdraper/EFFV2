// backend/services/shared/src/svc/s2s/headers.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *   - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Canonical S2S header names and runtime contract ID validation helpers.
 * - Ensures every S2S call carries a verifiable contract identity.
 *
 * Invariants:
 * - Request header:  X-NV-Contract: "<namespace>/<endpoint>@v<major>"
 * - Response header: X-NV-Response-Contract: "<namespace>/<endpoint>@v<major>"
 * - Contract IDs are static, literal constants declared in contract classes.
 * */
//* - Header values must match regex ^[a-z][a-z0-9-] */[a-z0-9-]+@v[1-9][0-9]*$

export const HDR_NV_CONTRACT = "X-NV-Contract";
export const HDR_NV_RESPONSE_CONTRACT = "X-NV-Response-Contract";

/** Type-safe Contract ID pattern. */
export type ContractId = `${string}/${string}@v${number}`;

/** Runtime syntax validator (used by ContractBase and SvcReceiver). */
export function assertContractId(
  id: string,
  where: string
): asserts id is ContractId {
  const re = /^[a-z][a-z0-9-]*\/[a-z0-9-]+@v[1-9][0-9]*$/i;
  if (!id || typeof id !== "string" || !re.test(id)) {
    throw new Error(`${where}: invalid contract id "${id}"`);
  }
}

/** Equality guard for S2S header checks. */
export function assertContractMatch(
  expected: ContractId,
  got: string | undefined,
  where: string
) {
  if (!got) throw new Error(`${where}: missing ${HDR_NV_CONTRACT} header`);
  assertContractId(got, where);
  if (got !== expected) {
    throw new Error(
      `${where}: contract_id_mismatch (expected "${expected}", got "${got}")`
    );
  }
}
