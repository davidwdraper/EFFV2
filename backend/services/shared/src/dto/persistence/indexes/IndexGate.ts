// backend/services/shared/src/dto/persistence/indexes/IndexGate.ts
/**
 * Docs:
 * - ADR-0106 (Lazy index ensure via persistence IndexGate + IndexCheckCache)
 *
 * Purpose:
 * - Small, stable contract for the runtime-wired index gate.
 *
 * Notes:
 * - DbReader/DbWriter/DbDeleter depend on this interface only.
 * - Concrete IndexGate implementation is wired into SvcRuntime as:
 *     rt.setCap("db.indexGate", new IndexGate(...))
 */

export type DtoCtorWithIndexes = {
  dbCollectionName: () => string;
  /** Declarative hints; structure interpreted by the concrete IndexGate. */
  indexHints: ReadonlyArray<unknown>;
  name?: string;
};

export interface IIndexGate {
  ensureForDtoCtor(dtoCtor: DtoCtorWithIndexes): Promise<void>;
}
