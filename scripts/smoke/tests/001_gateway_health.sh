#!/usr/bin/env bash
t1() {
  echo "-- $GW/live";          curl -fsS "$GW/live" | pretty
  echo "-- $GW/ready";         curl -fsS "$GW/ready" | pretty
  echo "-- $GW/health/live";   curl -fsS "$GW/health/live" | pretty
  echo "-- $GW/health/ready";  curl -fsS "$GW/health/ready" | pretty
  echo "-- $GW/healthz";       curl -fsS "$GW/healthz" | pretty
  echo "-- $GW/readyz";        curl -fsS "$GW/readyz" | pretty
}
register_test 1 "gateway health" t1
