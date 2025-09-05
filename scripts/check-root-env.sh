# scripts/check-root-env.sh
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FILE="${1:-$ROOT/.env.dev}"
FAIL=0

say() { printf "%b\n" "$*"; }
hdr() { say ""; say "── $* ─────────────────────────────────────────"; }

if [[ ! -f "$FILE" ]]; then
  say "❌ Root .env.dev not found: $FILE"
  exit 2
fi

say "🔍 Checking root env: $FILE"

# Strip comments/blank lines for some checks (but keep full file for reporting)
STRIPPED="$(mktemp)"; trap 'rm -f "$STRIPPED"' EXIT
sed -E '/^\s*#/d; /^\s*$/d' "$FILE" > "$STRIPPED"

# 1) NODE_ENV must be present
hdr "NODE_ENV"
if grep -Eq '^NODE_ENV=' "$STRIPPED"; then
  say "✅ NODE_ENV present: $(grep -E '^NODE_ENV=' "$STRIPPED" | tail -n1)"
else
  say "❌ Missing NODE_ENV in root .env.dev"
  FAIL=1
fi

# 2) Forbidden: SVCCONFIG_* in root
hdr "Forbidden: SVCCONFIG_* (must live under backend/services/svcconfig/.env.dev)"
if grep -nE '^[[:space:]]*SVCCONFIG_[A-Z0-9_]*=' "$FILE" >/dev/null; then
  say "❌ Found these in root .env.dev (move them to svcconfig/.env.dev):"
  grep -nE '^[[:space:]]*SVCCONFIG_[A-Z0-9_]*=' "$FILE"
  FAIL=1
else
  say "✅ No SVCCONFIG_* keys in root"
fi

# 3) Forbidden: *_SERVICE_URL in root
hdr "Forbidden: *_SERVICE_URL (moved to DB via svcconfig)"
if grep -nE '^[[:space:]]*[A-Z0-9_]+_SERVICE_URL=' "$FILE" >/dev/null; then
  say "❌ Found these *_SERVICE_URL entries (remove; use svcconfig DB):"
  grep -nE '^[[:space:]]*[A-Z0-9_]+_SERVICE_URL=' "$FILE"
  FAIL=1
else
  say "✅ No *_SERVICE_URL keys in root"
fi

# 4) Advisory: service-scoped prefixes in root
hdr "Advisory: service-scoped prefixes in root (should live in their service envs)"
WARN_PREFIXES='^(ACT_|USER_|GEO_|AUTH_|IMAGE_|LOG_|REPORTER_|PLACE_|GATEWAY_CORE_|GATEWAY_|S2S_)'
if grep -nE "^[[:space:]]*$WARN_PREFIXES[A-Z0-9_]*=" "$FILE" >/dev/null; then
  say "⚠️  Found potentially service-scoped keys:"
  grep -nE "^[[:space:]]*$WARN_PREFIXES[A-Z0-9_]*=" "$FILE" | sed -E 's/^/   /'
  say "    (If intentional, fine. Otherwise move to the appropriate service .env.dev.)"
else
  say "✅ No obvious service-scoped keys in root"
fi

# 5) Duplicate keys (portable AWK approach; no <(...) )
hdr "Duplicate keys"
DUPS="$(awk -F= '/^[A-Za-z0-9_]+=/ {k=$1; c[k]++} END {for (k in c) if (c[k]>1) print k}' "$STRIPPED" || true)"
if [[ -n "${DUPS:-}" ]]; then
  say "❌ Duplicate keys detected (dedupe these):"
  awk -F= -v KS="$DUPS" '
    BEGIN{
      n=split(KS, a, "\n");
      for(i=1;i<=n;i++) if (length(a[i])) dup[a[i]]=1;
    }
    /^[A-Za-z0-9_]+=/{ if ($1 in dup) printf "%d:%s\n", NR, $1 }
  ' "$FILE"
  FAIL=1
else
  say "✅ No duplicate keys"
fi

say ""
if [[ "$FAIL" -eq 0 ]]; then
  say "✅ Root .env.dev looks clean."
  exit 0
else
  say "❌ Issues found. Fix the items above."
  exit 1
fi
