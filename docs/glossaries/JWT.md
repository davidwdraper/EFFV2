# JWT + KMS Field Glossary (NowVibin Context)

This is a plain-English reference for all key JWT header and payload fields
you’ll see in NowVibin, along with KMS/JWKS terms.  
Use it whenever you design or review tokens or configure KMS.

---

## JWT Header (first segment)

| Field   | Meaning                           | Why it matters                                                                                                              |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **alg** | Algorithm (e.g. `RS256`, `ES256`) | Tells verifiers which crypto algorithm was used. Must match what you configure and what the KMS key supports.               |
| **kid** | Key ID                            | Points to the **exact key version** used to sign. Lets verifiers pick the right public key and makes key rotation painless. |
| **typ** | Token type (`JWT`)                | Optional but common; helps tooling know what’s inside.                                                                      |

---

## JWT Payload Claims (second segment)

| Field                     | Meaning                                          | Why it matters in NV                                                                                                                                                        |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iss** (issuer)          | Who created and signed the token.                | Should always be `"gateway"` for user access tokens, or `"gateway"`/`"gateway-core"` for S2S. All workers verify this strictly.                                             |
| **aud** (audience)        | Who the token is intended for.                   | Lets you scope tokens to internal services (`"internal-services"`) or to a special audience like `"internal-payments"`. Each service only accepts tokens with its audience. |
| **sub** (subject)         | The identity of the user or service.             | E.g. the `userId` for end-user tokens, or the calling service name for S2S. Useful for auditing.                                                                            |
| **exp** (expiration time) | Unix timestamp when the token stops being valid. | Your main lever on token lifetime: 90 s for S2S, 10–15 min for user access, 30 s for payments tokens.                                                                       |
| **nbf** (not before)      | Earliest time the token is valid.                | Optional; can help enforce “future-dated” tokens.                                                                                                                           |
| **iat** (issued at)       | When the token was created.                      | Good for logging/audit and for short-lived refresh logic.                                                                                                                   |
| **jti** (JWT ID)          | Unique identifier for this specific token.       | Used to detect replay and to invalidate a single token if needed.                                                                                                           |

---

## Custom / NV-Specific Claims

| Field             | Meaning                                        | Usage                                                                                                       |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **scope**         | List of permitted actions.                     | E.g. `["payments:egress"]` for purpose-bound money-handling tokens.                                         |
| **requestHash**   | Hash of a payment or critical request payload. | Binds the token to a specific action so it can’t be replayed with different data.                           |
| **risk**          | Risk level or classification.                  | Optional; can be used for stepped-up logging or rate limits (e.g. `risk:"high"` for payments).              |
| **roles / perms** | Application-specific role info.                | Could carry `userType`, `admin` flags, etc., if you prefer to encode them here instead of fetching from DB. |

---

## KMS / JWKS Terms

| Term                 | Meaning                                                                      | Where you see it                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **KMS key version**  | Each asymmetric key in Google Cloud KMS can have multiple numbered versions. | Appears in your key resource path (`projects/.../cryptoKeyVersions/3`) and is surfaced as the `kid` in your JWT header. |
| **JWKS**             | JSON Web Key Set: the published list of public keys and metadata.            | All services fetch this (with ETag caching) so they can verify signatures locally.                                      |
| **ETag / last-good** | Cache control mechanism.                                                     | Lets services keep using a known-good key set if the next fetch fails, preventing outages during rotations.             |

---

## Example NowVibin S2S JWT

**Header**

```json
{
  "alg": "RS256",
  "kid": "projects/nv-prod/locations/global/keyRings/jwt/cryptoKeys/s2s/cryptoKeyVersions/42",
  "typ": "JWT"
}
```

{
"iss": "gateway",
"aud": "internal-services",
"sub": "gateway",
"exp": 1727044920,
"iat": 1727044860,
"jti": "3b1d07c5-9d8b-4dfb-8c7a-4e4820ab1a43"
}

TL;DR

iss = who minted the token.

aud = who may accept it.

kid = which key version signed it.

exp / nbf / iat = when it’s valid.

jti = unique token ID.

scope / requestHash / roles = NV-specific constraints.
