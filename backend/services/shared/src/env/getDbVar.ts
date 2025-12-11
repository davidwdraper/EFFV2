// backend/services/shared/src/env/getDbVar.ts
/**
 * Docs:
 * - ADR-0074 (DB_STATE, getDbVar(), getVar() guardrail, and `_infra` DBs)
 * - LDD-36 (DB_STATE & DB naming architecture)
 *
 * Purpose:
 * - Canonical DB name resolver for all services.
 *   • Infra DBs (ending in `_infra`) are returned as-is.
 *   • Domain DBs are qualified with `_${DB_STATE}`.
 *
 * Invariants:
 * - baseDbName must be a non-empty string.
 * - For non-infra DBs, dbState must be a non-empty string.
 * - `_infra` DBs are **never** state-qualified.
 */
export function getDbVar(
  baseDbName: string,
  dbState: string | undefined | null
): string {
  const trimmedBase = (baseDbName ?? "").trim();

  if (!trimmedBase) {
    throw new Error(
      "getDbVar: base DB name is empty. " +
        "Ops: verify NV_MONGO_DB is set correctly in env-service for this service."
    );
  }

  // 1) Infra DBs: suffix `_infra` means state-invariant; return as-is.
  if (trimmedBase.endsWith("_infra")) {
    return trimmedBase;
  }

  // 2) Domain DBs: require DB_STATE and append it.
  const state = (dbState ?? "").trim();
  if (!state) {
    throw new Error(
      `getDbVar: DB_STATE is missing or empty for base="${trimmedBase}". ` +
        "Ops: ensure DB_STATE is defined in service-root and propagated into app state " +
        "before constructing DB clients or calling getDbVar()."
    );
  }

  // Optional safety: if someone already passed a state-qualified name, don't double-suffix.
  if (trimmedBase.endsWith(`_${state}`)) {
    return trimmedBase;
  }

  return `${trimmedBase}_${state}`;
}
