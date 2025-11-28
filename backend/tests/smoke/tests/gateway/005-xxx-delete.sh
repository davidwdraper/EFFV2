# backend/tests/smoke/tests/005-xxx-delete.sh
#!/usr/bin/env bash
# 005 - create then delete
#
# NowVibin Smoke — create then delete (slug/port aware, fully independent)
# Strategy:
#   1) CREATE a record (DtoBag) with a simple payload, no id fields.
#   2) Let the service mint the canonical _id.
#   3) DELETE by that same _id.
#
# Contract (post _id + bag-only refactor):
#   - CREATE returns: { ok: true, items: [ { _id, ... } ] }
#   - DELETE returns: { ok: true, items: [], meta: { count: 0, dtoType, op: "delete" } }
#
# Rules:
#   - _id is always minted inside the app and included in the JSON sent to Mongo.
#   - No idFieldName, no ${slug}Id, no external id picking.
#   - Client never relies on DB internals; it just uses the _id the service returns.

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

# Just a run marker for debugging/log correlation; not used as an id anymore.
RUN_ID="$(date +%s%N)"

# --- Step 1: CREATE (DtoBag) --------------------------------------------------
CREATE_URL="${BASE}/${DTO_TYPE}/create"
say "→ PUT  ${CREATE_URL}"

CREATE_BODY="$(jq -n --arg type "$DTO_TYPE" '
  {
    items: [
      {
        type: $type,
        doc: {
          txtfield1: "probe",
          txtfield2: ("probe_run_" + "'"$RUN_ID"'"),
          numfield1: 1,
          numfield2: 1
        }
      }
    ]
  }
')"

printf '%s\n' "$CREATE_BODY" | jq . >&2 || true

CREATE_JSON="$(curl -fsS -X PUT "$CREATE_URL" -H 'content-type: application/json' --data "$CREATE_BODY")"
printf '%s\n' "$CREATE_JSON" | jq . || true

# Validate create contract (post _id refactor)
[ "$(jq -r '.ok // empty' <<<"$CREATE_JSON")" = "true" ] || { say "ERROR: create.ok != true"; exit 2; }

ITEM_COUNT_CREATE="$(jq -r '.items | length' <<<"$CREATE_JSON")"
[ "$ITEM_COUNT_CREATE" -eq 1 ] || { say "ERROR: expected exactly 1 item, got $ITEM_COUNT_CREATE"; exit 2; }

CREATED_ID="$(jq -r '.items[0]._id // empty' <<<"$CREATE_JSON")"
[ -n "$CREATED_ID" ] || { say "ERROR: create missing items[0]._id"; exit 2; }

say "created _id=${CREATED_ID}"

# --- Step 2: DELETE by the canonical _id --------------------------------------
DEL_URL="${BASE}/${DTO_TYPE}/delete/${CREATED_ID}"
say "→ DELETE ${DEL_URL}"

DEL_JSON="$(curl -fsS -X DELETE "$DEL_URL")"
printf '%s\n' "$DEL_JSON" | jq . || true

# Validate delete contract (bag-only, no tombstone DTOs)
[ "$(jq -r '.ok // empty' <<<"$DEL_JSON")" = "true" ] || { say "ERROR: delete.ok != true"; exit 3; }

ITEM_COUNT_DELETE="$(jq -r '.items | length' <<<"$DEL_JSON")"
[ "$ITEM_COUNT_DELETE" -eq 0 ] || { say "ERROR: expected 0 items after delete, got $ITEM_COUNT_DELETE"; exit 3; }

META_COUNT_DELETE="$(jq -r '.meta.count // -1' <<<"$DEL_JSON")"
[ "$META_COUNT_DELETE" -eq 0 ] || { say "ERROR: expected meta.count == 0 after delete, got $META_COUNT_DELETE"; exit 3; }

OP_DELETE="$(jq -r '.meta.op // empty' <<<"$DEL_JSON")"
[ "$OP_DELETE" = "delete" ] || { say "ERROR: expected meta.op == \"delete\", got \"$OP_DELETE\""; exit 3; }

say "created and deleted _id=${CREATED_ID} (slug=${SLUG}, dtoType=${DTO_TYPE}, port=${PORT})"
