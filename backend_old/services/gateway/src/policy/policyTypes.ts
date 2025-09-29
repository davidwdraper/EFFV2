// backend/services/gateway/src/policy/policyTypes.ts
/**
 * Contracts mirrored for convenience (use zod types at boundaries).
 */
export type UserAssertionMode = "required" | "optional" | "forbidden";

export interface RouteRule {
  method: string;
  path: string;
  public: boolean;
  userAssertion: UserAssertionMode;
  opId?: string;
}

export interface RoutePolicy {
  revision: number;
  defaults: { public: boolean; userAssertion: UserAssertionMode };
  rules: RouteRule[];
}
