// backend/services/shared/src/dto/persistence/adapters/mongo/dupKeyError.ts
/**
 * Purpose:
 * - Centralize Mongo error parsing.
 * - Provide a standard DuplicateKeyError usable across services.
 */

export type DuplicateInfo = {
  index?: string;
  key?: Record<string, unknown>;
  message: string;
};

export function parseDuplicateKey(err: unknown): DuplicateInfo | null {
  const e = err as any;
  const code = e?.code ?? e?.errorCode;
  const message = String(e?.message ?? "");

  if (code !== 11000 && !/E11000 duplicate key error/i.test(message)) {
    return null;
  }

  const out: DuplicateInfo = { message };

  const idxMatch = message.match(/index:\s*([^\s]+)\s/);
  if (idxMatch) out.index = idxMatch[1];

  const keyMatch = message.match(/dup key:\s*(\{.*\})/);
  if (keyMatch) {
    // Try to coerce to JSON object
    const raw = keyMatch[1];
    try {
      const jsonish = raw.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":');
      out.key = JSON.parse(jsonish);
    } catch {
      out.key = { raw };
    }
  }

  return out;
}

export class DuplicateKeyError extends Error {
  public readonly index?: string;
  public readonly key?: Record<string, unknown>;
  public readonly original?: unknown;

  constructor(info: DuplicateInfo, original?: unknown) {
    super(info.message);
    this.name = "DuplicateKeyError";
    this.index = info.index;
    this.key = info.key;
    this.original = original;
  }
}
