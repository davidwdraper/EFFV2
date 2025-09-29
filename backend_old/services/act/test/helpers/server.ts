// backend/services/act/test/helpers/server.ts
import supertest from "supertest";
import { app } from "../../src/app";

/**
 * Keep this dead simple. Different supertest versions return slightly different
 * agent types; avoiding explicit generics prevents TS incompatibilities.
 */
let cached: any;

export function getAgent() {
  if (!cached) {
    if (!app) throw new Error("[server] ../../src/app did not export `app`");
    cached = supertest(app);
  }
  return cached;
}

export default { getAgent };
