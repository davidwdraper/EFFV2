#!/usr/bin/env bash
t3() { curl -fsS "$ACT/health/live" | pretty; }
register_test 3 "act health" t3
