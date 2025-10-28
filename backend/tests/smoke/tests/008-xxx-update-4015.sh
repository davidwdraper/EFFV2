# backend/tests/smoke/tests/008-xxx-update-4015.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 008 — xxx update (create → patch → read verify → delete)
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
# ============================================================================
set -euo pipefail

# Resolve lib.sh (prints URL traces to STDERR)
SMOKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$SMOKE_DIR/lib.sh"

BASE="http://127.0.0.1:4015/api/xxx/v1"

# Unique-ish suffix to avoid rare collisions if a prior run aborted pre-delete
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

echo "→ PUT ${BASE}/create" >&2
CRESP="$(curl -sS -X PUT "${BASE}/create" \
  -H 'content-type: application/json' \
  -H 'x-request-id: smoke-008-create' \
  -d "${CREATE_BODY}")"

# Expect { ok: true, id: "<id>" }
OK="$(jq -er '.ok' <<<"$CRESP")" || { echo "ERROR: create: non-JSON or missing .ok"; echo "$CRESP"; exit 1; }
[ "$OK" = "true" ] || { echo "ERROR: create failed"; echo "$CRESP" | jq .; exit 1; }
ID="$(jq -er '.id' <<<"$CRESP")" || { echo "ERROR: create: missing .id"; echo "$CRESP"; exit 1; }
[ -n "$ID" ] || { echo "ERROR: empty id from create"; exit 1; }

# 2) PATCH (real test) --------------------------------------------------------
PATCH_BODY="$(cat <<JSON
{
  "txtfield1": "u8-alpha-updated-${SUF}",
  "numfield2": 99
}
JSON
)"

echo "→ PATCH ${BASE}/${ID}" >&2
URESP="$(curl -sS -X PATCH "${BASE}/${ID}" \
  -H 'content-type: application/json' \
  -H 'x-request-id: smoke-008-patch' \
  -d "${PATCH_BODY}")"

# Expect { ok: true, id: "<same id>" }
UOK="$(jq -er '.ok' <<<"$URESP")" || { echo "ERROR: update: non-JSON or missing .ok"; echo "$URESP"; exit 1; }
[ "$UOK" = "true" ] || { echo "ERROR: update failed"; echo "$URESP" | jq .; exit 1; }
UPD_ID="$(jq -er '.id' <<<"$URESP")" || { echo "ERROR: update: missing .id"; echo "$URESP"; exit 1; }
[ "$UPD_ID" = "$ID" ] || { echo "ERROR: update id mismatch: got $UPD_ID expected $ID"; exit 1; }

# 2b) READ to verify updated fields ------------------------------------------
echo "→ GET  ${BASE}/read?id=${ID}" >&2
RRESP="$(curl -sS "${BASE}/read?id=${ID}" \
  -H 'x-request-id: smoke-008-read')"

# Expect { ok: true, doc: { _id, txtfield1: "u8-alpha-updated-...", numfield2: 99, ... } }
ROK="$(jq -er '.ok' <<<"$RRESP")" || { echo "ERROR: read: non-JSON or missing .ok"; echo "$RRESP"; exit 1; }
[ "$ROK" = "true" ] || { echo "ERROR: read failed"; echo "$RRESP" | jq .; exit 1; }

# Assertions on updated fields
V_TXT="$(jq -er '.doc.txtfield1' <<<"$RRESP")" || { echo "ERROR: read: missing doc.txtfield1"; echo "$RRESP"; exit 1; }
V_NUM="$(jq -er '.doc.numfield2' <<<"$RRESP")" || { echo "ERROR: read: missing doc.numfield2"; echo "$RRESP"; exit 1; }

[[ "$V_TXT" == "u8-alpha-updated-${SUF}" ]] || { echo "ERROR: txtfield1 not updated: $V_TXT"; exit 1; }
[[ "$V_NUM" == "99" || "$V_NUM" == 99 ]] || { echo "ERROR: numfield2 not updated: $V_NUM"; exit 1; }

# 3) DELETE (cleanup) ---------------------------------------------------------
echo "→ DELETE ${BASE}/${ID}" >&2
DRESP="$(curl -sS -X DELETE "${BASE}/${ID}" \
  -H 'x-request-id: smoke-008-delete')"

DOK="$(jq -er '.ok' <<<"$DRESP" 2>/dev/null || echo "false")"
[ "$DOK" = "true" ] || {
  # Some delete handlers may not return { ok:true }; tolerate 200-ish with empty/alt body,
  # but try one last verification: read should be 404 after delete.
  echo "→ GET  ${BASE}/read?id=${ID} (post-delete check)" >&2
  RDRESP="$(curl -sS "${BASE}/read?id=${ID}" -H 'x-request-id: smoke-008-read-postdel' || true)"
  if jq -e '.status == 404' >/dev/null 2>&1 <<<"$RDRESP"; then
    : # treat as pass
  else
    echo "ERROR: delete did not confirm cleanup"
    echo "Delete response:"; echo "$DRESP" | jq . || echo "$DRESP"
    echo "Read-after-delete:"; echo "$RDRESP" | jq . || echo "$RDRESP"
    exit 1
  fi
}

echo "OK: update verified and cleaned up"
