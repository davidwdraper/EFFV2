// backend/services/audit/src/bootstrap/AuditWalBootstrap.ts
/**
 * WHY: Consolidates WAL env, build, replay, and flush timer so app.ts stays orchestration-only.
 */
import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import { buildWal } from "@nv/shared/wal/WalBuilder";
import { DbAuditWriter } from "@nv/shared/wal/writer/DbAuditWriter";

export interface AuditWalRuntime {
  wal: IWalEngine;
  writer: DbAuditWriter;
  stop: () => void; // stops timers
}

export async function startAuditWal(opts: {
  log: {
    info(o: any, m?: string): void;
    warn(o: any, m?: string): void;
    error(o: any, m?: string): void;
  };
}): Promise<AuditWalRuntime> {
  const dir = mustGet("WAL_DIR");
  const cadenceMs = mustInt("WAL_FLUSH_MS", { min: 0 });
  const replayOnBoot =
    (process.env.AUDIT_REPLAY_ON_BOOT || "false").toLowerCase() === "true";

  const writer = new DbAuditWriter();
  const wal = await buildWal({
    journal: { dir },
    writer: { instance: writer },
  });

  if (replayOnBoot) {
    try {
      const { CursorlessWalReplayer } = await import(
        "@nv/shared/wal/replay/CursorlessWalReplayer"
      );
      const replayer = new CursorlessWalReplayer({ dir });
      const stats = await replayer.replay(writer);
      opts.log.info({ ...stats }, "wal_replay_on_boot_completed");
    } catch (err: any) {
      opts.log.error({ err: err?.message }, "wal_replay_on_boot_failed");
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (cadenceMs > 0) {
    timer = setInterval(async () => {
      try {
        const { accepted } = await wal.flush();
        if (accepted > 0) opts.log.info({ accepted }, "wal_flush");
      } catch (err: any) {
        opts.log.error({ err: err?.message }, "wal_flush_failed");
      }
    }, cadenceMs);
    (timer as any)?.unref?.();
  }

  return {
    wal,
    writer,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function mustGet(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[audit] ${name} is required`);
  return v;
}
function mustInt(name: string, { min = 1 } = {}): number {
  const raw = process.env[name];
  if (raw == null) throw new Error(`[audit] ${name} is required`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min)
    throw new Error(`[audit] ${name} must be >= ${min}`);
  return n;
}
