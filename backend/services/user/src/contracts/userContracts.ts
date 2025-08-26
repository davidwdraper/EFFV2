// backend/services/user/src/contracts/userContracts.ts
import { z } from "zod";

// Basic email string (controller/service will normalize)
export const zEmail = z.string().email().max(320);

// Shared, optional name parts
export const zNameParts = z.object({
  firstname: z.string().trim().min(1).max(100),
  middlename: z.string().trim().max(100).optional().or(z.literal("")),
  lastname: z.string().trim().min(1).max(100),
});

// Create (signup)
export const zUserCreate = z
  .object({
    email: zEmail,
    password: z.string().min(6).max(200),
  })
  .and(zNameParts)
  .and(
    z.object({}).passthrough() // allow extra UI fields; model validates
  );

// Replace (PUT): full document semantics
export const zUserReplace = z
  .object({
    email: zEmail,
  })
  .and(zNameParts)
  .and(z.object({}).passthrough());

// Patch (PATCH): partial update
export const zUserPatch = z
  .object({
    email: zEmail.optional(),
    password: z.string().min(6).max(200).optional(),
    firstname: z.string().trim().min(1).max(100).optional(),
    middlename: z.string().trim().max(100).optional(),
    lastname: z.string().trim().min(1).max(100).optional(),
  })
  .and(z.object({}).passthrough());

// Params
export const zUserIdParam = z.object({
  id: z.string().trim().min(1),
});

// Responses are shaped by DTOs; controllers/services will sanitize.
