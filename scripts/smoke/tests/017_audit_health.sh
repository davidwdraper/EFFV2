#!/usr/bin/env bash
# NowVibin — Smoke Tests
# Test: 017 — Audit service health (direct, NOT via gateway)
#
# WHY:
# - Gateway is noisy right now; first verify the audit worker is healthy post-KMS.
# - Talks directly to the audit service (no edge auth).
#
# EXPECTATIONS:
# - Audit listens on port 4015 by default (overridable via $AUDIT).
# - Health endpoints are public. Prefer /health/live; fallback /healthz.
#
# DOCS:
# - docs/architecture/backend/HEALTH_READINESS.md
# - docs/architecture/backend/SOP.md
#
# ADRs:
# - docs/adr/0033-audit-health-direct-check-pre-gateway.md (proposed)

# NOTE: Do NOT `source` smoke.lib.sh here — the runner already does that.
#       Re-sourcing would reset TESTS=() and hide earlier tests.

t17() {
  local AUD_BASE="${AUDIT:-http://127.0.0.1:4015}"

  # Prefer /health/live; fall back to /healthz for older builds.
  local paths=("/health/live" "/healthz")
  local url body code ok=""

  for p in "${paths[@]}"; do
    url="${AUD_BASE%/}${p}"
    echo "→ GET $url"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo "000")
    if [[ "$code" != "200" ]]; then
      echo "… HTTP $code"
      continue
    fi

    body=$(curl -fsS "$url" || true)
    [[ -n "${body:-}" ]] && echo "$body" | pretty

    # Accept either { ok: true } or { status: "ok" }
    if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
      local val
      val=$(echo "$body" | "${JQ:-jq}" -r '.ok // .status // empty' 2>/dev/null || echo "")
      if [[ "$val" == "true" || "$val" == "ok" ]]; then ok="yes"; break; fi
    fi
    if echo "$body" | grep -Eqi '"ok"[[:space:]]*:[[:space:]]*true|(^|[^a-z])ok([^a-z]|$)'; then
      ok="yes"; break
    fi
  done

  if [[ "$ok" != "yes" ]]; then
    echo "❌ audit health NOT OK (tried: ${paths[*]})"
    return 1
  fi

  echo "✅ audit health OK"
  return 0
}

register_test 17 "audit health (direct 4015)" t17
