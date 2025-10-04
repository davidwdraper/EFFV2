# backend/tests/smoke/lib.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin — Smoke Test Library (macOS Bash 3.2 compatible)
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs: docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
#
# Notes:
# - All URL traces are printed to STDERR so stdout remains clean JSON for jq.
# - TIMEOUT_MS controls curl timeout; default 3000ms.
# =============================================================================
set -Eeuo pipefail

# env: GATEWAY_BASE_URL, SVCFAC_BASE_URL, TIMEOUT_MS
: "${TIMEOUT_MS:=3000}"

_has_cmd(){ command -v "$1" >/dev/null 2>&1; }
_req_time(){ echo "$(( (TIMEOUT_MS+999)/1000 ))"; }

# --- Logging helpers (stderr) -------------------------------------------------
_log_url(){ # _log_url <METHOD> <URL>
  # Keep it dead simple; no ANSI for old terminals
  echo "→ ${1} ${2}" >&2
}

# --- Curl wrappers that preserve clean stdout for jq --------------------------
_get_json(){ # _get_json <url>
  local url="$1"
  _log_url "GET" "$url"
  curl -sS --max-time "$(_req_time)" "$url"
}

_post_json(){ # _post_json <url> <json>
  local url="$1" body="$2"
  _log_url "POST" "$url"
  curl -sS --max-time "$(_req_time)" -H 'content-type: application/json' -X POST -d "$body" "$url"
}

# --- Assertions ---------------------------------------------------------------
json_eq(){ # json_eq '<json>' 'jq-expr' 'expected'
  local body="$1" expr="$2" expect="$3"
  [[ "$(jq -er "$expr" <<<"$body")" == "$expect" ]]
}

# --- Common requests ----------------------------------------------------------
health_direct(){ # health_direct <baseUrl>
  local base="$1"
  _get_json "$base/health"
}

# Canonical gateway health path for services (no legacy /live)
# Example slug: user, auth, etc.
health_via_gateway(){ # health_via_gateway <slug>
  local slug="$1"
  _get_json "$GATEWAY_BASE_URL/api/$slug/health"
}

# Convenience for future create tests (kept for parity)
create_direct(){ # create_direct <baseUrl> <json>
  local base="$1" body="$2"
  _post_json "$base" "$body"
}

create_via_gateway(){ # create_via_gateway <slug> <version> <json>
  local slug="$1" ver="$2" body="$3"
  _post_json "$GATEWAY_BASE_URL/api/$slug/v$ver/create" "$body"
}
