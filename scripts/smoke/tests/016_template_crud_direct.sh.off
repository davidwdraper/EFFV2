# scripts/smoke/tests/016_template_crud_direct.sh
#!/usr/bin/env bash
# Template service basic CRUD via direct port (no gateway)
# Expects the Template service to expose SOP endpoints:
#  - PUT /api/templates        → create (service generates _id)
#  - GET /api/templates/:id    → read
#  - DELETE /api/templates/:id → idempotent delete
#
# Env overrides (optional):
#   TEMPLATE=http://127.0.0.1:4999

t16() {
  local TOKEN; TOKEN=$(TOKEN_CORE)

  # Base URL (override with TEMPLATE=http://host:port)
  local svc_base="${TEMPLATE:-http://127.0.0.1:4999}"
  local base="$svc_base/api/templates"

  # Minimal payload matching template DTO (per your error: firstname/lastname/email)
  # Timestamp for uniqueness
  local ts; ts="$(date +%s)"
  local payload; payload=$(cat <<JSON
{
  "firstname": "Smoke$ts",
  "lastname": "Tester",
  "email": "smoke+$ts@example.test"
}
JSON
)

  # CREATE (PUT collection root)
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ direct PUT did not return _id"; exit 1; }
  echo "✅ created template _id=$id"

  # READ (GET by id)
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty

  # DELETE (idempotent)
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}

register_test 16 "template PUT+GET+DELETE direct (4999) minimal (JWT core)" t16
