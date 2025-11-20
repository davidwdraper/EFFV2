# LDD-34 — Shared S2S Gate & Authorization Flow

## 1. Purpose
Every NV microservice — t_entity_crud templates, env-service, svcconfig, audit, gateway — must protect private endpoints with a consistent, deterministic authorization mechanism.

## 2. The Rules of Engagement
**Rule 1 — Gateway is the only public door.**  
**Rule 2 — Every worker service expects S2S tokens.**  
**Rule 3 — Health endpoints have no authorization.**  
**Rule 4 — Protected routes enforce verifyS2S before parsers or pipelines.**

## 3. Required S2S Headers
- authorization
- x-request-id
- x-service-name
- x-api-version

## 4. Token Shape
Minted inside shared, fields: iss, aud, sub, exp, iat.

## 5. Flow: Gateway → Worker Service
1. Client → Gateway  
2. Gateway → Worker with S2S headers  
3. Worker → verifyS2S  
4. Success → pipeline  
5. Failure → RFC7807 error

## 6. Implementation: Where It Lives
backend/services/shared/src/security/

## 7. Mounting Order
health → verifyS2S → parsers → routes

## 8. Smoke Test Expectations
Unauthorized health OK, protected without headers = 401, with mint = 200.

## 9. Consequences
Inconsistent trust boundaries and test failures.

## 10. Summary
Gateway public only; services trust signed internal calls.
