# backend/tests/smoke/tests/005-xxx-delete-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — create then delete (slug/port aware, fully independent)
# Strategy:
#   1) CREATE a record (DtoBag) with a caller-provided UUID.
#   2) DELETE by that same public DTO id (never DB _id).
# Contract notes:
#   - CREATE returns: { ok: true, id: "<uuid>" }
#   - DELETE returns: { ok: true, deleted: 1 }
#   - READ is not required here; id is canonical and round-trips unchanged.

set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }; }
need curl; need jq; need date

# --- Config (env override friendly) -------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

# Precedence: BASE env (if set) > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
fi

say() { printf '%s\n' "$*" >&2; }

# Make a stable id; prefer uuidgen
RUN_ID="$(date +%s%N)"
if command -v uuidgen >/dev/null 2>&1; then
  NEW_ID="$(uuidgen | tr 'A-Z' 'a-z')"
else
  NEW_ID="$(printf "%s-%06d" "${RUN_ID}" "$RANDOM")"
fi

# --- Step 1: CREATE (DtoBag) --------------------------------------------------
CREATE_URL="${BASE}/${DTO_TYPE}/create"
say "→ PUT  ${CREATE_URL}"

CREATE_BODY="$(jq -n --arg id "$NEW_ID" --arg type "$DTO_TYPE" --arg k "${SLUG}Id" '
  {
    items: [
      {
        type: $type,
        doc: {
          id: $id,
          txtfield1: "probe",
          txtfield2: ("probe_" + $id),
          numfield1: 1,
          numfield2: 1
        }
      }
    ]
  }
  | (.items[0].doc[$k] = $id)
')"

printf '%s\n' "$CREATE_BODY" | jq . >&2 || true

CREATE_JSON="$(curl -fsS -X PUT "$CREATE_URL" -H 'content-type: application/json' --data "$CREATE_BODY")"
printf '%s\n' "$CREATE_JSON" | jq . || true

# Validate create contract
[ "$(jq -r '.ok // empty' <<<"$CREATE_JSON")" = "true" ] || { say "ERROR: create.ok != true"; exit 2; }
CREATED_ID="$(jq -r '.id // empty' <<<"$CREATE_JSON")"
[ -n "$CREATED_ID" ] || { say "ERROR: create missing .id"; exit 2; }
[ "$CREATED_ID" = "$NEW_ID" ] || { say "ERROR: create echoed different id ($CREATED_ID != $NEW_ID)"; exit 2; }

say "created id=${NEW_ID}"

# --- Step 2: DELETE by the canonical id --------------------------------------
DEL_URL="${BASE}/${DTO_TYPE}/delete/${NEW_ID}"
say "→ DELETE ${DEL_URL}"

DEL_JSON="$(curl -fsS -X DELETE "$DEL_URL")"
printf '%s\n' "$DEL_JSON" | jq . || true

# Validate delete contract
[ "$(jq -r '.ok // empty' <<<"$DEL_JSON")" = "true" ] || { say "ERROR: delete.ok != true"; exit 3; }
jq -e '(.deleted|tostring) == "1"' >/dev/null <<<"$DEL_JSON" || { say "ERROR: deleted != 1"; exit 3; }

say "✅ PASS: created and deleted id=${NEW_ID} (slug=${SLUG}, dtoType=${DTO_TYPE}, port=${PORT})"
