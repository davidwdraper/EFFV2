// backend/services/shared/contracts/common.ts
import { z } from "zod";

export const ObjectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "_id must be 24-hex");
export type ObjectIdString = z.infer<typeof ObjectIdString>;

export const ISODateString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be ISO8601 date string");
export type ISODateString = z.infer<typeof ISODateString>;

export const GeoPoint = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const ProblemJson = z.object({
  type: z.string().optional(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
});
export type ProblemJson = z.infer<typeof ProblemJson>;

export const Paged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    total: z.number().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    items: z.array(item),
  });
export type Paged<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};
