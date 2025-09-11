#!/usr/bin/env bash
# 20 — svcconfig health
# Hits svcconfig’s open health endpoints (live/ready/healthz/readyz).

t20() {
  local SVC="${SVC:-${SVCCONFIG_URL:-http://127.0.0.1:4013}}"

  echo "-- $SVC/live";    curl -fsS "$SVC/live"    | pretty
  echo "-- $SVC/ready";   curl -fsS "$SVC/ready"   | pretty
  echo "-- $SVC/healthz"; curl -fsS "$SVC/healthz" | pretty
  echo "-- $SVC/readyz";  curl -fsS "$SVC/readyz"  | pretty
}

register_test 20 "svcconfig health" t20
