# Security (Shared)

S2S:

- HS256 JWT
- `aud=internal-services`
- `iss ∈ {gateway, gateway-core}`
- gateway-core always re-mints downstream S2S

End-user assertion:

- Header `X-NV-User-Assertion` (JWT), forwarded for context; never used as S2S

Headers (selected):

- `X-Request-Id` (propagated)
- `X-NV-Billing-Account` (gateway-derived; client-supplied values are ignored/overwritten)
- Optional: `X-NV-Billing-Subaccount`

PII posture:

- No raw bodies in audit. Only sizes (`bytesIn/bytesOut`) and hashes (`bodyHash`, optional `respHash`) + meta.
