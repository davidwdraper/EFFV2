---
id: 0007
title: Problem+JSON as canonical error shape
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [errors, rfc7807, observability, consistency]
---

# Status
Accepted

# Context
Our services returned inconsistent error JSON (different fields, sometimes plaintext). Clients and on-call could not reliably parse or correlate errors across gateway/core/workers.

# Decision
Adopt RFC 7807 (application/problem+json) as the sole wire format for error responses. Emit fields: type, title, status, detail (safe), instance (request URL). Include requestId alongside for correlation. Centralize via shared middleware mounted in createServiceApp().

# Consequences
✅ Predictable client handling and monitoring; ✅ easy correlation via requestId; ⚠️ must scrub internal messages on 5xx; ⚠️ migration touches global error handling in each service.

# Alternatives Considered
1) Per-service JSON shapes (drift). 2) Plain text/HTML (unparseable). 3) Vendor-specific error envelopes (lock-in). Rejected.

# References
- SOP: docs/architecture/backend/SOP.md\n- Design: docs/design/backend/errors/problem-json.md\n- Code: backend/services/shared/middleware/problemJson.ts
