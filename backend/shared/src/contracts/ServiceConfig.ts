// backend/shared/src/contracts/ServiceConfig.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Canonical contract for service-config records stored in Mongo
 *   and mirrored in the Gateway.
 */

export interface PolicyRule {
  method: string; // e.g., "GET" | "PUT" | "PATCH" | "DELETE"
  path: string; // e.g., "/v1/*"
  userAssertion?: "required" | "optional";
  public?: boolean;
  opId?: string;
}

export interface Policy {
  revision: number;
  defaults?: {
    public?: boolean;
    userAssertion?: "required" | "optional";
  };
  rules?: PolicyRule[];
}

export interface ServiceConfigRecord {
  _id?: unknown;
  slug: string; // e.g., "user"
  version: number; // e.g., 1
  enabled: boolean;
  allowProxy?: boolean;
  baseUrl: string; // e.g., "http://127.0.0.1:4020"
  outboundApiPrefix?: string; // e.g., "/api"
  configRevision?: number;
  policy?: Policy;
  etag?: string;
  healthPath?: string;
  exposeHealth?: boolean;
  protectedGetPrefixes?: string[];
  publicPrefixes?: string[];
  updatedAt?: Date | string;
  updatedBy?: string;
  notes?: string;
  __v?: number;
}
