// backend/services/shared/src/dto/persistence/indexes/IndexCheckCache.ts
/**
 * Docs:
 * - ADR-0106 (Lazy index ensure via persistence IndexGate + IndexCheckCache)
 *
 * Purpose:
 * - Process-local cache to ensure we only perform index verification/build once
 *   per (mongoUri, mongoDb, collectionName) in a given node process.
 *
 * Notes:
 * - This is intentionally simple and in-memory.
 * - It prevents repeated ensure calls across many handlers.
 */

export class IndexCheckCache {
  private readonly ensured = new Map<string, Promise<void>>();

  public ensureOnce(key: string, work: () => Promise<void>): Promise<void> {
    const k = (key ?? "").trim();
    if (!k) {
      throw new Error(
        "INDEXCHECKCACHE_KEY_EMPTY: ensureOnce(key, work) requires a non-empty key."
      );
    }

    const existing = this.ensured.get(k);
    if (existing) return existing;

    const p = work().catch((err) => {
      // If it fails, allow retry on next call.
      this.ensured.delete(k);
      throw err;
    });

    this.ensured.set(k, p);
    return p;
  }
}
