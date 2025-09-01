#!/usr/bin/env bash
t2() { curl -fsS "$CORE/health/live" | pretty; }
register_test 2 "gateway-core health" t2
