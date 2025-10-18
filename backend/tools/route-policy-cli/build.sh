pnpm run build
chmod +x dist/route-policy-cli.js    # ensure it’s executable
pnpm unlink --global || true         # clean old link
pnpm link --global                   # re-register new build
hash -r                              # clear shell command cache
route-policy-cli --help