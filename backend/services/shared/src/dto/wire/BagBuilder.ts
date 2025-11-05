// backend/services/shared/src/dto/wire/BagBuilder.ts
/**
 * Docs:
 * - ADRs:
 *   - ADR-0049 (Registry; DTO-only validation; IDs on edges)
 *   - ADR-0050 (Wire Bag Envelope & Cursor Semantics)
 *
 * Purpose:
 * - Build DtoBag<IDto> either from a wire payload (items[] of typed DTO JSON)
 *   or from already-hydrated DTOs.
 *
 * Notes:
 * - No logging here; callers add logs with requestId.
 * - Throws plain Errors with actionable messages (include requestId when provided).
 */

import { DtoBag } from "../DtoBag";
import type { IDto } from "../IDto";
import type { BagMeta } from "./BagMeta";
import type { IDtoRegistry } from "../../registry/RegistryBase";

export type FromWireOptions = {
  registry: IDtoRegistry;
  maxItems?: number; // default 1000
  maxBytes?: number; // default 2_000_000
  requireSingleton?: boolean;
  allowEmpty?: boolean; // default true
  requestId?: string;
};

export type FromDtosOptions = {
  requestId?: string;
  limit?: number;
  total?: number | null;
  cursor?: string | null;
};

type WirePayload = {
  items?: unknown;
  meta?: Partial<BagMeta>;
};

export class BagBuilder {
  /** Wire → Bag (payload is a JSON string or already-parsed object) */
  static fromWire(
    payload: string | unknown,
    opts: FromWireOptions
  ): { bag: DtoBag<IDto>; meta: BagMeta } {
    const {
      registry,
      requestId,
      requireSingleton,
      allowEmpty = true,
      maxItems = 1000,
      maxBytes = 2_000_000,
    } = opts;

    let body: WirePayload;

    if (typeof payload === "string") {
      if (payload.length > maxBytes) {
        throw new Error(
          `PayloadTooLarge: body length ${
            payload.length
          } exceeds maxBytes ${maxBytes}${
            requestId ? ` (requestId=${requestId})` : ""
          }`
        );
      }
      try {
        body = JSON.parse(payload);
      } catch {
        throw new Error(
          `BadRequest: invalid JSON in request body${
            requestId ? ` (requestId=${requestId})` : ""
          }`
        );
      }
    } else if (payload && typeof payload === "object") {
      body = payload as WirePayload;
    } else {
      throw new Error(
        `BadRequest: payload must be JSON string or object${
          requestId ? ` (requestId=${requestId})` : ""
        }`
      );
    }

    if (!Array.isArray(body.items)) {
      throw new Error(
        `BadRequest: body.items must be an array${
          requestId ? ` (requestId=${requestId})` : ""
        }`
      );
    }

    if (body.items.length > maxItems) {
      throw new Error(
        `PayloadTooLarge: items length ${
          body.items.length
        } exceeds maxItems ${maxItems}${
          requestId ? ` (requestId=${requestId})` : ""
        }`
      );
    }

    if (!allowEmpty && body.items.length === 0) {
      throw new Error(
        `BadRequest: expected at least 1 item (allowEmpty=false)${
          requestId ? ` (requestId=${requestId})` : ""
        }`
      );
    }

    const items: IDto[] = [];
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i] as Record<string, unknown>;
      const t = String(item?.type ?? "");
      if (!t) {
        throw new Error(
          `BadRequest: items[${i}] missing required "type" discriminator (ADR-0049)${
            requestId ? ` (requestId=${requestId})` : ""
          }`
        );
      }
      // NEW
      const Ctor = registry.resolveCtorByType(t); // throws if unknown
      const dto = Ctor.fromJson(item, { mode: "wire", validate: true });

      items.push(dto);
    }

    if (requireSingleton && items.length !== 1) {
      throw new Error(
        `BadRequest: expected exactly 1 item but got ${items.length}${
          requestId ? ` (requestId=${requestId})` : ""
        }`
      );
    }

    const bag = new DtoBag<IDto>(items);

    const meta: BagMeta = {
      cursor: body.meta?.cursor ?? null,
      limit:
        typeof body.meta?.limit === "number"
          ? Math.max(0, Math.min(body.meta.limit, maxItems))
          : Math.min(items.length, maxItems),
      total:
        typeof body.meta?.total === "number" || body.meta?.total === null
          ? body.meta.total
          : undefined,
      requestId: body.meta?.requestId || requestId || generateRequestId(),
      elapsedMs:
        typeof body.meta?.elapsedMs === "number" ? body.meta.elapsedMs : 0,
    };

    return { bag, meta };
  }

  /** DTOs → Bag (already hydrated) */
  static fromDtos(
    dtos: Iterable<IDto>,
    opts?: FromDtosOptions
  ): { bag: DtoBag<IDto>; meta: BagMeta } {
    const arr = Array.isArray(dtos) ? dtos.slice() : Array.from(dtos);
    const bag = new DtoBag<IDto>(arr);
    const meta: BagMeta = {
      cursor: opts?.cursor ?? null,
      limit: typeof opts?.limit === "number" ? opts!.limit : arr.length,
      total:
        typeof opts?.total === "number" || opts?.total === null
          ? opts!.total
          : arr.length,
      requestId: opts?.requestId ?? generateRequestId(),
      elapsedMs: 0,
    };
    return { bag, meta };
  }
}

function generateRequestId(): string {
  // Tiny, dependency-free requestId (not the same as DTO id semantics).
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
}
