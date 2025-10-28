// backend/services/shared/src/dto/persistence/indexes/ensureIndexes.ts
/**
 * Docs:
 * - ADR-0040/41 (DTO-only persistence)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 * - ADR-0045 (Index Hints — burn-after-read & boot ensure)
 *
 * Purpose:
 * - Deterministically ensure Mongo indexes for a set of DTOs at service boot.
 * - Consumes index hints (burn-after-read) and applies them idempotently.
 * - Logs post-ensure index inventory for drift detection.
 */

import type { SvcEnvDto } from "../../svcenv.dto";
import { consumeIndexHints } from "../index-hints"; // keep your existing export point
import { mongoFromHints } from "./mongoFromHints";
import { applyMongoIndexes } from "./applyMongoIndexes";
import { getMongoCollectionFromSvcEnv } from "../adapters/mongo/connectFromSvcEnv";

type ILogger = {
  info?: Function;
  warn?: Function;
  error?: Function;
  debug?: Function;
};

export async function ensureIndexesForDtos(opts: {
  dtos: Function[];
  svcEnv: SvcEnvDto;
  log?: ILogger;
}): Promise<void> {
  const { dtos, svcEnv, log } = opts;

  const dtoNames = dtos.map((d) => (d as any)?.name ?? "UnknownDto");
  log?.info?.(
    { event: "index_ensure_enter", dtos: dtoNames, count: dtos.length },
    "Boot index ensure: enter"
  );

  // Resolve the target collection via env (ADR-0044). Single collection per service.
  const collection = await getMongoCollectionFromSvcEnv(svcEnv);

  for (const DtoCtor of dtos) {
    const dtoName = (DtoCtor as any)?.name ?? "UnknownDto";
    try {
      const hints = consumeIndexHints(DtoCtor);

      log?.info?.(
        {
          event: "index_hints_consumed",
          dto: dtoName,
          count: hints?.length ?? 0,
          sample: hints && hints[0],
        },
        "Index hints read"
      );

      if (!hints || hints.length === 0) {
        log?.debug?.(
          { event: "index_no_hints", dto: dtoName },
          "No index hints to apply"
        );
        continue;
      }

      const entity =
        (DtoCtor as any)?.entitySlug ??
        (DtoCtor as any)?.collectionName ??
        dtoName.replace(/Dto$/, "").toLowerCase();

      const specs = mongoFromHints(entity, hints);

      await applyMongoIndexes(collection, specs, {
        collectionName:
          (svcEnv as any).tryEnvVar?.("NV_MONGO_COLLECTION") ??
          (svcEnv as any).getEnvVar?.("NV_MONGO_COLLECTION") ??
          entity,
        log,
      });

      // Post-ensure inventory for observability
      if (typeof (collection as any).indexes === "function") {
        try {
          const inv = await (collection as any).indexes();
          log?.info?.(
            {
              event: "index_inventory",
              dto: dtoName,
              count: Array.isArray(inv) ? inv.length : undefined,
              names: Array.isArray(inv) ? inv.map((i) => i.name) : undefined,
            },
            "Index inventory after ensure"
          );
        } catch (e) {
          log?.warn?.(
            {
              event: "index_inventory_failed",
              dto: dtoName,
              error: (e as Error)?.message,
            },
            "Failed to list indexes after ensure"
          );
        }
      }

      log?.info?.(
        {
          event: "index_ensured",
          dto: dtoName,
          count: specs.length,
        },
        "Indexes ensured (idempotent)"
      );
    } catch (err) {
      log?.error?.(
        {
          event: "index_ensure_failed",
          dto: dtoName,
          error: (err as Error)?.message ?? String(err),
        },
        "Failed to ensure indexes"
      );
      // Non-fatal by design
    }
  }

  log?.info?.({ event: "index_ensure_exit" }, "Boot index ensure: exit");
}
