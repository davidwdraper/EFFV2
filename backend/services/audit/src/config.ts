// backend/services/audit/src/config.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 *
 * Why:
 * - Centralized, typed config for the Audit service.
 * - Turns this file into a real module via explicit exports to satisfy TS.
 */

export const SERVICE_NAME = "audit";

export type AuditConfig = {
  port: number;
  mongoUri: string;
  exposeHealth: boolean;
};

const num = (v: string | undefined) => Number(v ?? NaN);

export const config: AuditConfig = {
  port: num(process.env.AUDIT_PORT),
  mongoUri: process.env.AUDIT_MONGO_URI || "",
  exposeHealth:
    String(process.env.EXPOSE_HEALTH || "").toLowerCase() === "true",
};
