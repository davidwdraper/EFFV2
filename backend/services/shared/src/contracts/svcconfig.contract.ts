// backend/services/shared/src/contracts/svcconfig.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route Policy via svcconfig (service + policy merged payload)
 *
 * Canonical truth for svcconfig read responses consumed by the gateway.
 * There is no legacy shape—this is the only contract.
 */

import { z } from "zod";

/** Accept only http(s) URLs, including local dev like http://127.0.0.1 */
const httpUrl = z
  .string()
  .trim()
  .min(1, "URL required")
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be a valid http(s) URL");

export const UserAssertionMode = z.enum(["required", "optional", "forbidden"]);

export const RouteRuleSchema = z.object({
  method: z.string().trim().toUpperCase(), // HTTP verb
  path: z.string().trim(), // normalized, starts with /v<major>/...
  public: z.boolean(),
  userAssertion: UserAssertionMode,
  opId: z.string().trim().optional(),
});

export type RouteRule = z.infer<typeof RouteRuleSchema>;

export const RoutePolicySchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  defaults: z.object({
    public: z.boolean().default(false),
    userAssertion: UserAssertionMode.default("required"),
  }),
  rules: z.array(RouteRuleSchema),
});

export type RoutePolicy = z.infer<typeof RoutePolicySchema>;

export const SvcConfigSchema = z.object({
  slug: z.string().min(1),
  version: z.number().int().nonnegative(),
  baseUrl: httpUrl,
  outboundApiPrefix: z.string().default("/api"),
  enabled: z.boolean(),
  allowProxy: z.boolean(),
  configRevision: z.number().int().nonnegative(),
  policy: RoutePolicySchema,
  etag: z.string().min(1),
  updatedAt: z.string().min(1), // ISO 8601
});

export type SvcConfig = z.infer<typeof SvcConfigSchema>;
