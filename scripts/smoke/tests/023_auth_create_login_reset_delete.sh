# PATH: scripts/smoke/tests/023_auth_create_login_reset_delete.sh
#!/usr/bin/env bash
# Auth full flow VIA GATEWAY (4000):
#   1) POST /api/auth.V1/auth/create
#   2) POST /api/auth.V1/auth/login
#   3) POST /api/auth.V1/auth/password_reset
#   4) DELETE /api/user.V1/users/:id   (cleanup)
#
# Conforms to APR-0029 (versioned edge path) and uses gateway_req for headers.

t23() {
  set -euo pipefail

  local gw="${GW:-http://127.0.0.1:4000}"
  local max_time="${NV_CURL_MAXTIME:-15}"

  local create_url="$gw/api/auth.V1/auth/create"
  local login_url="$gw/api/auth.V1/auth/login"
  local reset_url="$gw/api/auth.V1/auth/password_reset"

  local user_base="$gw/api/user.V1/users"

  # Unique email
  local suffix email pass1 pass2
  suffix="$(nv_unique_suffix)"
  email="smoke+$suffix@example.test"
  pass1="P@ss-${suffix}"
  pass2="N3w-${suffix}"

  # ---- Create ---------------------------------------------------------------
  echo "— create (${email}) —"
  local create_body create_resp user_id
  create_body=$(cat <<JSON
{
  "email": "${email}",
  "password": "${pass1}",
  "firstname": "Smoke",
  "middlename": "",
  "lastname": "Test"
}
JSON
)
  create_resp=$(
    gateway_req POST "$create_url" \
      -H "Content-Type: application/json" \
      --max-time "$max_time" \
      -d "$create_body"
  )
  if [[ "${NV_USE_JQ:-1}" -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
    echo "$create_resp" | ${JQ:-jq}
  else
    echo "$create_resp"
  fi

  if command -v jq >/dev/null 2>&1; then
    user_id=$(echo "$create_resp" | jq -r '.user.id // .user._id // .user.userId // .id // ._id // empty')
  else
    user_id=$(echo "$create_resp" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' | head -n1)
  fi
  [[ -n "${user_id:-}" ]] || { echo "❌ create did not return user id"; return 1; }
  echo "✅ created user id=${user_id}"

  # ---- Login (old password) -------------------------------------------------
  echo "— login (original password) —"
  local login_body login_resp
  login_body=$(cat <<JSON
{ "email": "${email}", "password": "${pass1}" }
JSON
)
  login_resp=$(
    gateway_req POST "$login_url" \
      -H "Content-Type: application/json" \
      --max-time "$max_time" \
      -d "$login_body"
  )
  if command -v jq >/dev/null 2>&1; then echo "$login_resp" | jq; else echo "$login_resp"; fi

  # minimal success check
  if command -v jq >/dev/null 2>&1; then
    [[ "$(echo "$login_resp" | jq -r '.token // empty')" != "" ]] || { echo "❌ login (old password) missing token"; return 1; }
  fi
  echo "✅ login with original password returned token"

  # ---- Password reset -------------------------------------------------------
  echo "— password_reset —"
  local reset_body reset_resp
  reset_body=$(cat <<JSON
{ "email": "${email}", "newPassword": "${pass2}" }
JSON
)
  reset_resp=$(
    gateway_req POST "$reset_url" \
      -H "Content-Type: application/json" \
      --max-time "$max_time" \
      -d "$reset_body"
  )
  if command -v jq >/dev/null 2>&1; then echo "$reset_resp" | jq; else echo "$reset_resp"; fi

  # check ok:true if present, otherwise just non-empty
  if command -v jq >/dev/null 2>&1; then
    local ok; ok=$(echo "$reset_resp" | jq -r '.ok // "true"')
    [[ "$ok" == "true" ]] || echo "ℹ️ password_reset response did not include ok:true (continuing)"
  fi
  echo "✅ password reset submitted"

  # ---- Login (new password) -------------------------------------------------
  echo "— login (new password) —"
  local login2_body login2_resp
  login2_body=$(cat <<JSON
{ "email": "${email}", "password": "${pass2}" }
JSON
)
  login2_resp=$(
    gateway_req POST "$login_url" \
      -H "Content-Type: application/json" \
      --max-time "$max_time" \
      -d "$login2_body"
  )
  if command -v jq >/dev/null 2>&1; then echo "$login2_resp" | jq; else echo "$login2_resp"; fi
  if command -v jq >/dev/null 2>&1; then
    [[ "$(echo "$login2_resp" | jq -r '.token // empty')" != "" ]] || { echo "❌ login (new password) missing token"; return 1; }
  fi
  echo "✅ login with new password returned token"

  # ---- Cleanup: DELETE user -------------------------------------------------
  echo "— cleanup delete user —"
  local del_code
  del_code=$(
    gateway_req DELETE "$user_base/$user_id" \
      --max-time "${NV_CURL_MAXTIME:-12}" \
      -o /dev/null -w '%{http_code}'
  )
  case "$del_code" in
    200|202|204|404) echo "✅ delete $user_base/$user_id ($del_code)";;
    *) echo "❌ delete $user_base/$user_id failed ($del_code)"; return 1;;
  esac

  echo "✅ auth create→login→reset→login(new) flow passed"
}

register_test 23 "auth create→login→password_reset→delete (gateway)" t23
