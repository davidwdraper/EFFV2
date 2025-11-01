# backend/tests/smoke/tests/008-xxx-update-4015.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 008 — update (create → patch → read verify → delete)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
# ============================================================================
set -euo pipefail

# Resolve lib.sh (prints URL traces to STDERR)
SMOKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$SMOKE_DIR/lib.sh"

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

# Unique-ish suffix to avoid collisions if a prior run aborted pre-delete
SUF="${RANDOM}"

# 1) CREATE -------------------------------------------------------------------
CREATE_BODY="$(cat <<JSON
{
  "txtfield1": "u8-alpha-${SUF}",
  "txtfield2": "u8-bravo-${SUF}",
  "numfield1": 8,
  "numfield2": 88
}
JSON
)"

CRESP="$(_put_json "${BASE}/create" "${CREATE_BODY}")"

# Expect JSON + { ok: true, id | <slug>Id }
echo "${CRESP}" | jq -e . >/dev/null
OK="$(jq -er '.ok' <<<"${CRESP}")" || { echo "ERROR: create: non-JSON or missing .ok"; echo "${CRESP}"; exit 1; }
[ "${OK}" = "true" ] || { echo "ERROR: create failed"; echo "${CRESP}" | jq .; exit 1; }

ID="$(jq -r --arg k "${SLUG}Id" '.id // .[$k] // .xxxId // .doc[$k] // .doc.xxxId // empty' <<<"${CRESP}")"
[ -n "${ID}" ] || { echo "ERROR: create: missing DTO id (.id / .${SLUG}Id / .xxxId)"; echo "${CRESP}" | jq .; exit 1; }

# 2) PATCH (real test) --------------------------------------------------------
PATCH_BODY="$(cat <<JSON
{
  "txtfield1": "u8-alpha-updated-${SUF}",
  "numfield2": 99
}
JSON
)"

# Route supports PATCH /:xxxId
URESP="$(curl -sS -X PATCH "${BASE}/${ID}" \
  -H 'content-type: application/json' \
  -H 'x-request-id: smoke-008-patch' \
  -d "${PATCH_BODY}")"

# Expect { ok: true, id: "<same id>" }
echo "${URESP}" | jq -e . >/dev/null
UOK="$(jq -er '.ok' <<<"${URESP}")" || { echo "ERROR: update: non-JSON or missing .ok"; echo "${URESP}"; exit 1; }
[ "${UOK}" = "true" ] || { echo "ERROR: update failed"; echo "${URESP}" | jq .; exit 1; }
UPD_ID="$(jq -r '.id // empty' <<<"${URESP}")"
[ -n "${UPD_ID}" ] || { echo "ERROR: update: missing .id"; echo "${URESP}" | jq .; exit 1; }
[ "${UPD_ID}" = "${ID}" ] || { echo "ERROR: update id mismatch: got ${UPD_ID} expected ${ID}"; exit 1; }

# 2b) READ to verify updated fields ------------------------------------------
# Read accepts query id or xxxId; prefer xxxId
RRESP="$(_get_json "${BASE}/read?${SLUG}Id=${ID}")"

ROK="$(jq -er '.ok' <<<"${RRESP}")" || { echo "ERROR: read: non-JSON or missing .ok"; echo "${RRESP}"; exit 1; }
[ "${ROK}" = "true" ] || { echo "ERROR: read failed"; echo "${RRESP}" | jq .; exit 1; }

# Assertions on updated fields
V_TXT="$(jq -er '.doc.txtfield1' <<<"${RRESP}")" || { echo "ERROR: read: missing doc.txtfield1"; echo "${RRESP}"; exit 1; }
V_NUM="$(jq -er '.doc.numfield2' <<<"${RRESP}")" || { echo "ERROR: read: missing doc.numfield2"; echo "${RRESP}"; exit 1; }

[[ "${V_TXT}" == "u8-alpha-updated-${SUF}" ]] || { echo "ERROR: txtfield1 not updated: ${V_TXT}"; exit 1; }
[[ "${V_NUM}" == "99" || "${V_NUM}" == 99 ]] || { echo "ERROR: numfield2 not updated: ${V_NUM}"; exit 1; }

# 3) DELETE (cleanup) ---------------------------------------------------------
# Router supports bare DELETE /:xxxId, which we use here.
DRESP="$(_del_json "${BASE}/${ID}")"

# Prefer { ok:true }; if not, verify via read-after-delete returns 404
DOK="$(jq -er '.ok // empty' <<<"${DRESP}" 2>/dev/null || echo "")"
if [ "${DOK}" != "true" ]; then
  RDAFTER="$(_get_json "${BASE}/read?${SLUG}Id=${ID}")" || true
  if jq -e '(.status|tostring=="404") or (.code|ascii_upcase=="NOT_FOUND")' >/dev/null 2>&1 <<<"${RDAFTER}"; then
    : # treat as pass
  else
    echo "ERROR: delete did not confirm cleanup"
    echo "Delete response:"; echo "${DRESP}" | jq . || echo "${DRESP}"
    echo "Read-after-delete:"; echo "${RDAFTER}" | jq . || echo "${RDAFTER}"
    exit 1
  fi
fi

echo "OK: update verified and cleaned up for ${SLUG}:${PORT}"
