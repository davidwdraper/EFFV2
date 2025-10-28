# backend/tests/smoke/tests/014-audit-begin-end-shape.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 014: Audit BEGIN/END schema is enforced in persisted documents
# Flow:
#   1) PUT /api/auth/v1/create (via Gateway)
#   2) Find audit docs by X-Request-Id in Mongo
#   3) Assert:
#      - exactly 2 docs
#      - doc[0]: blob.phase="begin", blob.target has slug/version/route/method
#      - doc[1]: blob.phase="end", blob.target..., blob.status in {ok,error}, httpCode is int
# Dev defaults; override via env. macOS bash 3.2 compatible.
# ============================================================================
set -euo pipefail
if [ "${DEBUG:-0}" = "1" ]; then set -x; fi

# --- Dev defaults -------------------------------------------------------------
DEV_HOST="${DEV_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-4000}"
CREATE_URL="${CREATE_URL:-http://${DEV_HOST}:${GATEWAY_PORT}/api/auth/v1/create}"

MONGO_URI="${MONGO_URI:-${AUDIT_DB_URI:-}}"
MONGO_DB="${MONGO_DB:-${AUDIT_DB_NAME:-}}"
MONGO_COLL="${MONGO_COLL:-${AUDIT_DB_COLLECTION:-}}"

if ! command -v curl >/dev/null 2>&1; then echo "❌ curl required"; exit 1; fi
if ! command -v jq >/dev/null 2>&1; then echo "❌ jq required"; exit 1; fi

RID="smoke-014-$(date +%s)"
EMAIL="audit014+$RID@example.com"
PASSWORD="P@ssw0rd-$RID"

echo "→ PUT ${CREATE_URL} (rid=${RID})"
REQ_BODY="$(jq -n --arg email "$EMAIL" --arg pw "$PASSWORD" '{ email: $email, password: $pw }')"

RESP="$(curl -sS -X PUT \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: ${RID}" \
  --data "$REQ_BODY" \
  "$CREATE_URL" || true)"

if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "❌ Non-JSON response from gateway:"
  echo "$RESP"
  exit 1
fi

if [ -z "${MONGO_URI}" ] || [ -z "${MONGO_DB}" ] || [ -z "${MONGO_COLL}" ] || ! command -v mongosh >/dev/null 2>&1; then
  echo "ℹ️  Skipping DB validation (set MONGO_URI/MONGO_DB/MONGO_COLL and install mongosh)."
  echo "✅ PASS (envelope only)"
  exit 0
fi

# Give the gateway end-hook a beat to flush
SLEEP_MS="${AUDIT_WAL_FLUSH_MS:-${WAL_FLUSH_MS:-1000}}"
node -e "setTimeout(()=>{}, ${SLEEP_MS})"

# Pull docs and validate shapes in JS to keep it portable
JS=$(cat <<'EOS'
const [rid, dbName, collName] = [ARG_RID, ARG_DB, ARG_COLL];
const db = db.getSiblingDB(dbName);
const docs = db[collName].find({ "meta.requestId": rid }).sort({ "meta.ts": 1 }).toArray();

function fail(msg, obj){ print("❌ " + msg); if (obj) printjson(obj); quit(1); }
function ok(msg){ print("✅ " + msg); }

if (docs.length !== 2) fail(`expected 2 audit docs, found ${docs.length}`, docs);

const begin = docs[0], end = docs[1];

if (!begin.blob || begin.blob.phase !== "begin") fail("begin doc: missing blob.phase='begin'", begin);
const bt = begin.blob.target || {};
for (const k of ["slug","version","route","method"]) {
  if (!(k in bt)) fail(`begin doc: missing blob.target.${k}`, begin);
}

if (!end.blob || end.blob.phase !== "end") fail("end doc: missing blob.phase='end'", end);
const et = end.blob.target || {};
for (const k of ["slug","version","route","method"]) {
  if (!(k in et)) fail(`end doc: missing blob.target.${k}`, end);
}
if (!["ok","error"].includes(end.blob.status)) fail("end doc: invalid blob.status", end);
if (typeof end.blob.httpCode !== "number") fail("end doc: missing/invalid blob.httpCode", end);

ok("Audit docs have correct BEGIN/END shape");
EOS
)

OUT="$(mongosh "${MONGO_URI}/${MONGO_DB}" --quiet --eval \
"const ARG_RID='${RID}'; const ARG_DB='${MONGO_DB}'; const ARG_COLL='${MONGO_COLL}'; ${JS}")" || {
  echo "$OUT"
  exit 1
}

echo "$OUT"
echo "✅ PASS: 014-audit-begin-end-shape.sh"
