# Backend Overview

- Edge: `gateway` (public)
- Core: `gateway-core` (internal)
- Services: `user`, `act`, `place`, `event`, `geo`, `image`, `log`, `audit`, `svcconfig`
- Data: MongoDB per service; FS caches/WALs where specified

Request flow (happy path):

1. Client → `gateway` `/api/<slug>/<rest>`
2. `gateway-core` (internal hop, S2S re-mint)
3. Target service `/api/<resource…>` (health endpoints outside `/api`)

Guardrails:

- S2S required on all non-health worker routes
- HTTPS in staging/prod (HSTS); dev HTTP bound to 127.0.0.1
- Global error middleware → RFC 7807 problem responses
