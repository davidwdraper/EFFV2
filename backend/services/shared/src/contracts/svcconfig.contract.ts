// backend/services/shared/src/contracts/svcconfig.contract.ts
import { z } from "zod";

export const SvcConfigSchema = z.object({
  slug: z.string().min(1),
  enabled: z.boolean(),
  allowProxy: z.boolean(),
  baseUrl: z.string().url(),

  outboundApiPrefix: z.string().default("/api").optional(),
  healthPath: z.string().default("/health").optional(),
  exposeHealth: z.boolean().default(true).optional(),

  protectedGetPrefixes: z.array(z.string()).optional(),
  publicPrefixes: z.array(z.string()).optional(),

  overrides: z
    .object({
      timeoutMs: z.number().int().positive().optional(),
      breaker: z
        .object({
          failureThreshold: z.number().int().positive().optional(),
          halfOpenAfterMs: z.number().int().positive().optional(),
          minRttMs: z.number().int().positive().optional(),
        })
        .optional(),
      routeAliases: z.record(z.string(), z.string()).optional(),
    })
    .optional(),

  version: z.number().int().nonnegative(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
  notes: z.string().optional(),
});

export type ServiceConfig = z.infer<typeof SvcConfigSchema>;
