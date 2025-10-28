# backend/tests/smoke/tests/README.add-tests.md

# Adding smoke tests

Policy:

- Direct health checks: **gateway**, **svcfacilitator**.
- All other services: health is tested **through the gateway**.

Template (via gateway):

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
. "$(dirname "$0")/../lib.sh"

# Replace "auth" with your service slug once the gateway proxy is wired.
resp="$(health_via_gateway "auth")"
echo "$resp" | jq .
json_eq "$resp" '.service' "auth"
json_eq "$resp" '.status'  "ok"
```
