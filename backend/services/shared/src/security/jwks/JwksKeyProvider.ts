// // backend/services/shared/src/security/jwks/JwksKeyProvider.ts
// /**
//  * NowVibin (NV)
//  * Docs:
//  * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
//  * - ADR-0035 — JWKS Service for Public Keys
//  * - ADR-0036 — Token Minter using GCP KMS Sign
//  *
//  * Purpose (single concern):
//  * - Provide public keys (JWKs) by kid/alg with TTL-based caching.
//  * - Uses SvcClient to call the JWKS service only when no fresh key is cached.
//  *
//  * Why:
//  * - Keep `secureS2S` middleware slim and DI-driven.
//  * - Avoid unnecessary network calls for public material.
//  *
//  * Invariants:
//  * - No environment reads here. All inputs are constructor-required (fail-fast).
//  * - No hidden defaults; no literals tied to env or network.
//  * - Single-flight JWKS refresh to prevent thundering herd.
//  *
//  * Usage:
//  *   const provider = new JwksKeyProvider({
//  *     client: svcClientForInfra,      // SvcClient already configured; calls to slug "jwks" bypass auth
//  *     slug: "jwks",
//  *     version: 1,
//  *     cacheTtlMs: Number(process.env.NV_JWKS_CACHE_TTL_MS!), // required upstream
//  *     log,
//  *   });
//  *   const jwk = await provider.getJwk("kms:proj:loc:ring:key:v3", "RS256");
//  *
//  * Notes:
//  * - Assumes JWKS endpoint returns RouterBase envelope with body = { keys: JWK[] }.
//  *   Path resolved as: base("<...>/api/jwks/v1") + "/keys"
//  */

// import { z } from "zod";
// import type { SvcClient } from "../../svc/SvcClient";

// type LoggerLike = {
//   debug?: (o: Record<string, unknown>, msg?: string) => void;
//   info?: (o: Record<string, unknown>, msg?: string) => void;
//   warn?: (o: Record<string, unknown>, msg?: string) => void;
//   error?: (o: Record<string, unknown>, msg?: string) => void;
// };

// /** Minimal JWK shape for RSA & EC that we care about (extend as needed). */
// export type Jwk = {
//   kty: "RSA" | "EC";
//   kid: string;
//   alg?: string;
//   use?: "sig" | "enc";
//   // RSA
//   n?: string;
//   e?: string;
//   // EC
//   crv?: string;
//   x?: string;
//   y?: string;
// };

// const JwkSchema = z
//   .object({
//     kty: z.enum(["RSA", "EC"]),
//     kid: z.string().min(1),
//     alg: z.string().optional(),
//     use: z.enum(["sig", "enc"]).optional(),
//     n: z.string().optional(),
//     e: z.string().optional(),
//     crv: z.string().optional(),
//     x: z.string().optional(),
//     y: z.string().optional(),
//   })
//   .strict();

// const JwksBodySchema = z
//   .object({
//     keys: z.array(JwkSchema).min(1),
//   })
//   .strict();

// export interface IJwksKeyProvider {
//   /** Return a JWK matching kid (and alg if provided). Fetch JWKS only if cache has no fresh key. */
//   getJwk(kid: string, alg?: string): Promise<Jwk>;
//   /** Evict a specific kid (e.g., after a failed verify → next call refetches). */
//   evict(kid: string): void;
//   /** Clear all cached keys (e.g., after rotation event). */
//   clearAll(): void;
// }

// export type JwksKeyProviderOptions = {
//   client: SvcClient; // SvcClient DI — already configured; jwks slug should bypass auth
//   slug: string; // e.g., "jwks"
//   version: number; // e.g., 1
//   cacheTtlMs: number; // required; no defaults
//   now?: () => number; // epoch ms (injectable clock for tests)
//   log?: LoggerLike;
//   /** Optional: override path (default is "keys" under composed base). Provide explicitly if non-standard. */
//   path?: string;
// };

// type CacheEntry = {
//   jwk: Jwk;
//   /** epoch ms when this kid was fetched/inserted */
//   ts: number;
// };

// export class JwksKeyProvider implements IJwksKeyProvider {
//   private readonly client: SvcClient;
//   private readonly slug: string;
//   private readonly version: number;
//   private readonly cacheTtlMs: number;
//   private readonly now: () => number;
//   private readonly log?: LoggerLike;
//   private readonly path: string;

//   private readonly byKid = new Map<string, CacheEntry>();
//   private fetchAllInFlight: Promise<void> | null = null;

//   constructor(opts: JwksKeyProviderOptions) {
//     this.assertOpts(opts);
//     this.client = opts.client;
//     this.slug = opts.slug;
//     this.version = opts.version;
//     this.cacheTtlMs = opts.cacheTtlMs;
//     this.now = opts.now ?? (() => Date.now());
//     this.log = opts.log;
//     this.path = opts.path ?? "keys";

//     this.log?.info?.(
//       { slug: this.slug, version: this.version, cacheTtlMs: this.cacheTtlMs },
//       "JwksKeyProvider: initialized"
//     );
//   }

//   public async getJwk(kid: string, alg?: string): Promise<Jwk> {
//     if (!kid || typeof kid !== "string") {
//       throw new Error("[JwksKeyProvider.getJwk] kid is required");
//     }

//     const cached = this.byKid.get(kid);
//     const now = this.now();
//     if (cached && now - cached.ts < this.cacheTtlMs) {
//       if (this.algMatches(cached.jwk, alg)) {
//         this.log?.debug?.({ kid, alg, fresh: true }, "jwks cache hit");
//         return cached.jwk;
//       }
//       // alg mismatch: fall through to refresh to avoid returning a wrong alg
//       this.log?.warn?.(
//         { kid, wantAlg: alg, haveAlg: cached.jwk.alg },
//         "jwks alg mismatch — refreshing"
//       );
//     }

//     // Single-flight global refresh (fetches all keys once)
//     await this.refreshAllSingleFlight();

//     const fresh = this.byKid.get(kid);
//     if (
//       fresh &&
//       now - fresh.ts < this.cacheTtlMs &&
//       this.algMatches(fresh.jwk, alg)
//     ) {
//       this.log?.debug?.(
//         { kid, alg, fresh: true },
//         "jwks cache hit (post-refresh)"
//       );
//       return fresh.jwk;
//     }

//     this.log?.warn?.({ kid, alg }, "jwks key not found after refresh");
//     throw new Error(`[JwksKeyProvider] key not found for kid='${kid}'`);
//   }

//   public evict(kid: string): void {
//     if (!kid) return;
//     this.byKid.delete(kid);
//     this.log?.info?.({ kid }, "jwks evicted");
//   }

//   public clearAll(): void {
//     this.byKid.clear();
//     this.fetchAllInFlight = null;
//     this.log?.warn?.({}, "jwks cache cleared");
//   }

//   // ── Internals ─────────────────────────────────────────────────────────────

//   private async refreshAllSingleFlight(): Promise<void> {
//     if (this.fetchAllInFlight) {
//       this.log?.debug?.({}, "jwks refresh awaiting in-flight");
//       return this.fetchAllInFlight;
//     }
//     const p = this.fetchAll().finally(() => {
//       this.fetchAllInFlight = null;
//     });
//     this.fetchAllInFlight = p;
//     return p;
//   }

//   private async fetchAll(): Promise<void> {
//     this.log?.debug?.(
//       { slug: this.slug, version: this.version, path: this.path },
//       "jwks fetch begin"
//     );

//     // Expect RouterBase envelope with body = { keys: JWK[] }
//     const res = await this.client.callJson(
//       {
//         slug: this.slug,
//         version: this.version,
//         method: "GET",
//         path: this.path,
//         headers: { accept: "application/json" },
//       },
//       JwksBodySchema
//     );

//     const keys = res.body.keys;
//     const ts = this.now();

//     // Replace entries for any provided kid (do not clear others; some JWKS endpoints return subsets)
//     let inserted = 0;
//     for (const jwk of keys) {
//       this.byKid.set(jwk.kid, { jwk, ts });
//       inserted++;
//     }

//     this.log?.info?.(
//       { count: inserted, requestId: res.requestId },
//       "jwks fetch ok"
//     );
//   }

//   private algMatches(jwk: Jwk, wantAlg?: string): boolean {
//     if (!wantAlg) return true;
//     // Some JWKS omit 'alg'; in that case we accept and let downstream verifier enforce
//     if (!jwk.alg) return true;
//     return jwk.alg === wantAlg;
//   }

//   private assertOpts(o: JwksKeyProviderOptions) {
//     if (!o) throw new Error("[JwksKeyProvider] options are required");
//     if (!o.client) throw new Error("[JwksKeyProvider] client is required");
//     if (!o.slug || typeof o.slug !== "string")
//       throw new Error("[JwksKeyProvider] slug is required");
//     if (!Number.isFinite(o.version))
//       throw new Error("[JwksKeyProvider] version must be a number");
//     if (!Number.isFinite(o.cacheTtlMs) || o.cacheTtlMs <= 0) {
//       throw new Error("[JwksKeyProvider] cacheTtlMs must be a positive number");
//     }
//   }
// }
