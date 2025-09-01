#!/usr/bin/env bash
# user health (direct)
t11() { curl -fsS "$USER_URL/health/live" | pretty; }
register_test 11 "user health direct (4001)" t11
