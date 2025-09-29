// backend/tests/scripts/generateJwt.ts
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("Missing JWT_SECRET in env");

const now = Math.floor(Date.now() / 1000);

const payload = {
  sub: "uvtest-user",
  scope: "acts:rw",
  roles: ["tester"],
  iat: now,
  exp: now + 60 * 60, // 1 hour
};

const token = jwt.sign(payload, SECRET, { algorithm: "HS256" });
console.log(token);
