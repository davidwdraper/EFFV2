// backend/services/svcconfig/src/validators/svcconfig.dto.ts
import { z } from "zod";

const breakerZ = z
  .object({
    failureThreshold: z.number().int().positive().optional(),
    halfOpenAfterMs: z.number().int().positive().optional(),
    minRttMs: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

export const createSvcServiceDto = z
  .object({
    slug: z.string().min(1),
    enabled: z.boolean().optional(),
    allowProxy: z.boolean().optional(),
    baseUrl: z.string().url(),
    outboundApiPrefix: z.string().startsWith("/").optional(),
    healthPath: z.string().startsWith("/").optional(),
    exposeHealth: z.boolean().optional(),
    protectedGetPrefixes: z.array(z.string().startsWith("/")).optional(),
    publicPrefixes: z.array(z.string().startsWith("/")).optional(),
    overrides: z
      .object({
        timeoutMs: z.number().int().positive().optional(),
        breaker: breakerZ,
        routeAliases: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    notes: z.string().optional(),
  })
  .strict();

export const updateSvcServiceDto = createSvcServiceDto.partial().extend({
  version: z.number().int().positive().optional(),
  updatedBy: z.string().optional(),
});
