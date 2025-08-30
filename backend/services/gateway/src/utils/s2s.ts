import jwt from "jsonwebtoken";

export function mintS2S(
  caller = "gateway",
  ttl = Number(process.env.S2S_TOKEN_TTL_SEC || 60)
) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "s2s",
      iss: process.env.S2S_JWT_ISSUER || "gateway",
      aud: process.env.S2S_JWT_AUDIENCE || "internal-services",
      iat: now,
      exp: now + ttl,
      svc: caller,
    },
    process.env.S2S_JWT_SECRET!,
    { algorithm: "HS256", noTimestamp: true }
  );
}
