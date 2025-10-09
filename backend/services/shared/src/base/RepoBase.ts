// backend/shared/src/repo/RepoBase.ts
/**
 * Docs:
 * - SOP: Core SOP (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Thin shared base for Mongo-backed repos using DbClient & MongoDbFactory.
 * - Handles connect-once, ready checks, retries, and collection access.
 */

import type { DbClient } from "../db/DbClient";
import type { Collection, Document, IndexDescription } from "mongodb";

type RetryCfg = { attempts: number; baseDelayMs: number; maxDelayMs: number };

export interface RepoBaseConfig<TDoc extends Document = Document> {
  /** Logical collection name (required). */
  collection: string;
  /** Optional db name override (else DbClient’s default). */
  dbName?: string;
  /** Optional logger. */
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
  /** Retry policy for withRetry. (all optional on input) */
  retry?: Partial<RetryCfg>;
}

export abstract class RepoBase<TDoc extends Document = Document> {
  protected readonly db: DbClient;
  protected readonly collection: string;
  protected readonly dbName?: string;
  protected readonly logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
  private readonly retry: RetryCfg;

  constructor(db: DbClient, cfg: RepoBaseConfig<TDoc>) {
    if (!cfg.collection || !cfg.collection.trim()) {
      throw new Error("RepoBase: collection is required");
    }
    this.db = db;
    this.collection = cfg.collection.trim();
    this.dbName = cfg.dbName;
    this.logger = cfg.logger;

    // Normalize retry so fields are NEVER undefined later
    this.retry = {
      attempts: cfg.retry?.attempts ?? 3,
      baseDelayMs: cfg.retry?.baseDelayMs ?? 50,
      maxDelayMs: cfg.retry?.maxDelayMs ?? 1000,
    };
  }

  /** Get a typed Mongo collection. */
  protected async coll(): Promise<Collection<TDoc>> {
    const c = (await this.db.getCollection<TDoc>(
      this.collection,
      this.dbName
    )) as unknown as Collection<TDoc>;
    return c;
  }

  /** Ensure indexes once at startup (idempotent). Call from your app boot or repo ctor. */
  protected async ensureIndexes(indexes: IndexDescription[]): Promise<void> {
    if (!indexes || indexes.length === 0) return;
    const col = await this.coll();
    await col.createIndexes(indexes);
    this.logger?.info?.("[RepoBase] indexes ensured", {
      collection: this.collection,
      count: indexes.length,
    });
  }

  /** Bounded retry wrapper with jitter. */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    label = "repo.op"
  ): Promise<T> {
    const { attempts, baseDelayMs, maxDelayMs } = this.retry;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const delay = Math.min(
          maxDelayMs,
          Math.floor(baseDelayMs * 2 ** i + Math.random() * baseDelayMs)
        );
        this.logger?.warn?.(
          `[RepoBase] ${label} failed (attempt ${i + 1}/${attempts})`,
          { err: String(err) }
        );
        await sleep(delay);
      }
    }
    this.logger?.error?.(
      `[RepoBase] ${label} failed after ${attempts} attempts`,
      { err: String(lastErr) }
    );
    throw lastErr;
  }
}

/* util */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
