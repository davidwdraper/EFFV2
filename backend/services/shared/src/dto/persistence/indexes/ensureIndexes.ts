// backend/services/shared/src/dto/persistence/indexes/ensureIndexes.ts
/**
 * Docs:
 * - ADR-0040/41 (DTO-only persistence)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Deterministically ensure Mongo indexes for a set of DTOs at service boot.
 * - Consumes index hints (burn-after-read) and applies them idempotently.
 */

import type { SvcEnvDto } from "../../svcenv.dto";
import { consumeIndexHints } from "../index-hints";
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
  log?.debug?.(
    { event: "index_ensure_debug", dtosLen: dtos.length },
    "Boot index ensure: debug"
  );

  for (const DtoCtor of dtos) {
    const dtoName = (DtoCtor as any)?.name ?? "UnknownDto";
    try {
      const hints = consumeIndexHints(DtoCtor);

      log?.info?.(
        {
          event: "index_hints_consumed",
          dto: dtoName,
          count: hints.length,
          sample: hints[0],
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

      // Entity/collection naming: allow DTO to override via statics.
      const entity =
        (DtoCtor as any)?.entitySlug ??
        (DtoCtor as any)?.collectionName ??
        dtoName.replace(/Dto$/, "").toLowerCase();

      const specs = mongoFromHints(entity, hints);

      // Resolve the target collection using generic env keys (ADR-0044)
      const collection = await getMongoCollectionFromSvcEnv(svcEnv);

      // Log the resolved collection name we *intend* to use (for observability only)
      const collName =
        (svcEnv as any).tryEnvVar?.("NV_MONGO_COLLECTION") ??
        (svcEnv as any).getEnvVar?.("NV_MONGO_COLLECTION") ??
        entity;

      await applyMongoIndexes(collection, specs, {
        collectionName: String(collName),
        log,
      });

      log?.info?.(
        {
          event: "index_ensured",
          dto: dtoName,
          collection: collName,
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
      // Non-fatal by design: indexes are desirable, but shouldn't block boot.
    }
  }

  log?.info?.({ event: "index_ensure_exit" }, "Boot index ensure: exit");
}
