# scripts/smoke/tests/017_audit_health.sh
#!/usr/bin/env bash
# NowVibin smoke test 17 — Audit service health (direct)
# Uses $AUDIT if set, else defaults to http://127.0.0.1:4999

t17() {
  local AUD_BASE="${AUDIT:-http://127.0.0.1:4999}"
  local url="${AUD_BASE}/healthz"

  echo "→ GET $url"
  local body; body=$(curl -sS "$url") || { echo "❌ curl failed"; exit 1; }
  echo "$body" | pretty

  # Try to detect OK in a tolerant way
  if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v jq >/dev/null 2>&1; then
    local v; v=$(echo "$body" | jq -r '.ok // .status // empty')
    if [[ "$v" == "ok" || "$v" == "true" ]]; then
      echo "✅ audit health OK"
      return 0
    fi
  fi

  # Fallback: look for "ok" or '"ok":true' in raw
  if echo "$body" | grep -Eqi '"ok"[[:space:]]*:[[:space:]]*true|(^|[^a-z])ok([^a-z]|$)'; then
    echo "✅ audit health OK"
  else
    echo "❌ health not OK"
    exit 1
  fi
}

register_test 17 "audit health (direct 4999)" t17
