# 1) Simple pretty-print
curl -sS http://127.0.0.1:4000/health | jq .

# 2) Show HTTP status too
curl -sS -w '\nHTTP %{http_code}\n' -o >(jq .) http://127.0.0.1:4000/health

# 3) Fail the shell if not "ok"
curl -sS http://127.0.0.1:4000/health | jq -e 'select(.status=="ok")' >/dev/null \
  && echo "gateway health: OK" \
  || (echo "gateway health: NOT OK" >&2; exit 1)
