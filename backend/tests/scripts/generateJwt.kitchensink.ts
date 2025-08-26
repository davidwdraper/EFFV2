// backend/tests/scripts/generateJwt.kitchensink.ts
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

// Load env from a simple fallback chain (first existing wins)
const candidates = [
  process.env.ENV_FILE_E2E, // explicit override
  ".env.test", // repo root default
  ".env.dev",
  ".env.docker",
].filter(Boolean) as string[];

for (const p of candidates) {
  const abs = path.resolve(process.cwd(), p);
  if (fs.existsSync(abs)) {
    loadEnv({ path: abs });
    break;
  }
}

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  const tried = candidates.join(", ");
  throw new Error(`Missing JWT_SECRET in env. Tried: ${tried}`);
}

const now = Math.floor(Date.now() / 1000);

// Include many common claims so your gateway accepts it regardless of which it checks.
const payload = {
  // identity
  sub: "uvtest-user",
  userId: "uvtest-user",
  uid: "uvtest-user",
  id: "uvtest-user",
  email: "uvtest@example.com",
  name: "UV Test",

  // authorization (wide enough for create/update/delete)
  scope: "acts:rw acts:create acts:update acts:delete",
  scopes: ["acts:rw", "acts:create", "acts:update", "acts:delete"],
  roles: ["tester", "writer", "editor", "admin"],
  permissions: ["acts:create", "acts:read", "acts:update", "acts:delete"],

  // standard times
  iat: now,
  nbf: now - 5,
  exp: now + 60 * 60, // 1 hour
};

const token = jwt.sign(payload, SECRET, { algorithm: "HS256" });
console.log(token);
