#!/usr/bin/env bash
t4() { curl -fsS "$GEO/health/live" | pretty; }
register_test 4 "geo health" t4
