// backend/services/shared/src/registry/DtoRegistry.ts
/**
 * Docs:
 * - SOP: DTO-first; no raw JSON inside rails
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0057 (UUID; immutable)
 *
 * Purpose:
 * - Single global DTO registry for NV.
 * - One entry point:
 *     registry.create(dtoKey, body?)
 *
 * v1 scope (intentional):
 * - Implements ADR-0102 semantics using ctor-injection DTOs:
 *   - body absent  => internal mint (new DTO; ctor MUST mint _id)
 *   - body present => edge/db hydration (new DTO with { body, validate, mode }; ctor MUST require _id; MUST NOT mint)
 *
 * Single-concern rule:
 * - This registry does NOT touch Mongo.
 * - It only knows what DTOs are registered and how to construct them.
 */

import { DTO_INSTANTIATION_SECRET } from "./dtoInstantiationSecret";
import type {
  IDtoRegistry,
  RegistryDto,
  DtoKey,
  DtoCreateOptions,
  DtoCreateMode,
} from "./IDtoRegistry";

import type { DtoCtorWithIndexes } from "../dto/persistence/indexes/ensureIndexes";

import { DbEnvServiceDto } from "../dto/db.env-service.dto";
import { DbHandlerTestDto } from "../dto/db.handler-test.dto";
import { DbPromptDto } from "../dto/db.prompt.dto";
import { DbSvcconfigDto } from "../dto/db.svcconfig.dto";
import { DbTestHandlerDto } from "../dto/db.test-handler.dto";
import { DbUserAuthDto } from "../dto/db.user-auth.dto";
import { DbUserDto } from "../dto/db.user.dto";

/**
 * v1 ctor contract (ADR-0102):
 * - Scenario A: new Ctor(secret) => MUST mint _id
 * - Scenario B: new Ctor(secret, { body, validate, mode }) => MUST require _id; MUST NOT mint
 */
type DtoCtor<TDto extends RegistryDto = RegistryDto> = {
  new (
    secret: symbol,
    opts?: { body?: unknown; validate?: boolean; mode?: DtoCreateMode }
  ): TDto;

  // Optional: migration cross-check for db.* keys.
  dbCollectionName?: () => string;
};

type DtoEntry = {
  key: DtoKey;
  ctor: DtoCtor;
  /** For db.* keys, the collection is derived from key segment #2 (ADR-0103). */
  collectionName?: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && !!v.trim();
}

function parseDbCollectionFromKey(key: string): string | undefined {
  // ADR-0103: db.<collection>.<optional...>.dto
  const parts = String(key ?? "").split(".");
  if (parts.length < 3) return undefined;
  if (parts[0] !== "db") return undefined;
  const coll = parts[1];
  return isNonEmptyString(coll) ? coll.trim() : undefined;
}

export class DtoRegistry implements IDtoRegistry {
  private readonly byKey: Record<string, DtoEntry>;

  constructor() {
    // v1: explicit registrations. No manifests, no magic.
    this.byKey = {
      ["db.env-service.dto"]: {
        key: "db.env-service.dto",
        ctor: DbEnvServiceDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.env-service.dto"),
      },

      ["db.handler-test.dto"]: {
        key: "db.handler-test.dto",
        ctor: DbHandlerTestDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.handler-test.dto"),
      },

      ["db.prompt.dto"]: {
        key: "db.prompt.dto",
        ctor: DbPromptDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.prompt.dto"),
      },

      ["db.svcconfig.dto"]: {
        key: "db.svcconfig.dto",
        ctor: DbSvcconfigDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.svcconfig.dto"),
      },

      ["db.test-handler.dto"]: {
        key: "db.test-handler.dto",
        ctor: DbTestHandlerDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.test-handler.dto"),
      },

      ["db.user-auth.dto"]: {
        key: "db.user-auth.dto",
        ctor: DbUserAuthDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.user-auth.dto"),
      },

      ["db.user.dto"]: {
        key: "db.user.dto",
        ctor: DbUserDto as unknown as DtoCtor,
        collectionName: parseDbCollectionFromKey("db.user.dto"),
      },
    };

    this.assertBootInvariants();
  }

  public create<TDto extends RegistryDto = RegistryDto>(
    dtoKey: DtoKey,
    body?: unknown,
    opts?: DtoCreateOptions
  ): TDto {
    const entry = this.resolve(dtoKey);
    const ctor = entry.ctor as unknown as DtoCtor<TDto>;

    const dto =
      body === undefined
        ? new ctor(DTO_INSTANTIATION_SECRET)
        : new ctor(DTO_INSTANTIATION_SECRET, {
            body,
            validate: opts?.validate === true,
            mode: opts?.mode,
          });

    const id = dto.getId(); // throws if missing
    if (!dto.isValidId(id)) {
      throw new Error(
        `DTO_ID_INVALID: registry.create("${dtoKey}") produced DTO with invalid _id "${id}". ` +
          "Ops: enforce id via DTO hydration/setter using shared uuid helpers."
      );
    }

    if (entry.collectionName) {
      const have = dto.getCollectionName?.();
      if (!have) dto.setCollectionName(entry.collectionName);
    }

    return dto;
  }

  /**
   * ADR-0045:
   * Expose registered db.* DTO CLASSES that can participate in boot index ensure.
   *
   * This remains registry-only: we validate the class surface, but do not touch Mongo.
   */
  public listDbDtoCtorsForIndexes(): ReadonlyArray<DtoCtorWithIndexes> {
    const out: DtoCtorWithIndexes[] = [];

    for (const k of Object.keys(this.byKey)) {
      if (!k.startsWith("db.")) continue;

      const ctorAny: any = this.byKey[k].ctor;

      if (!Array.isArray(ctorAny?.indexHints)) {
        throw new Error(
          `DTO_INDEX_HINTS_MISSING: "${k}" ctor "${
            ctorAny?.name ?? "<anon>"
          }" is registered but does not expose static indexHints[]. ` +
            "Dev: add static indexHints to the DTO class (ADR-0045)."
        );
      }
      if (typeof ctorAny?.dbCollectionName !== "function") {
        throw new Error(
          `DTO_DB_COLLECTION_NAME_MISSING: "${k}" ctor "${
            ctorAny?.name ?? "<anon>"
          }" is registered but does not expose static dbCollectionName(). ` +
            "Dev: add dbCollectionName() to the DTO class (ADR-0045)."
        );
      }

      out.push(ctorAny as DtoCtorWithIndexes);
    }

    return out;
  }

  public resolve(dtoKey: DtoKey): DtoEntry {
    const k = String(dtoKey ?? "").trim();
    const hit = this.byKey[k];
    if (!hit) {
      throw new Error(
        `DTO_REGISTRY_UNKNOWN_KEY: No DTO registered for key "${k}". ` +
          "Ops: register it in shared/src/registry/DtoRegistry.ts (ADR-0103)."
      );
    }
    return hit;
  }

  private assertBootInvariants(): void {
    for (const k of Object.keys(this.byKey)) {
      if (!k.endsWith(".dto")) {
        throw new Error(
          `DTO_REGISTRY_KEY_INVALID: "${k}" must end with ".dto" (ADR-0103).`
        );
      }

      const entry = this.byKey[k];
      const ctorName = (entry.ctor as any)?.name;

      if (!isNonEmptyString(ctorName)) {
        throw new Error(
          `DTO_REGISTRY_CTOR_NAME_INVALID: key "${k}" registered with an unnamed ctor.`
        );
      }

      if (k.startsWith("db.")) {
        const coll = parseDbCollectionFromKey(k);
        if (!coll) {
          throw new Error(
            `DTO_REGISTRY_DB_KEY_INVALID: "${k}" must be "db.<collection>....dto" (ADR-0103).`
          );
        }

        const fn = (entry.ctor as any)?.dbCollectionName;
        if (typeof fn === "function") {
          const dtoColl = String(fn.call(entry.ctor) ?? "").trim();
          if (!dtoColl) {
            throw new Error(
              `DTO_REGISTRY_DB_COLL_EMPTY: "${k}" ctor.dbCollectionName() returned empty.`
            );
          }
          if (dtoColl !== coll) {
            throw new Error(
              `DTO_REGISTRY_DB_COLL_MISMATCH: "${k}" implies collection "${coll}" but ctor.dbCollectionName() returned "${dtoColl}". ` +
                "Ops: fix the DTO or fix the key; they must match (ADR-0103)."
            );
          }
        }
      }
    }
  }
}
