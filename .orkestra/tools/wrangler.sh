#!/bin/sh
# ---
# description: Cloudflare's wrangler, which `atelier shot --r2` publishes a proof through.
# version: "4.154.0"
# ---
#
# Installs `wrangler` into "$1" from npm. It signs in from the CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID named secrets, since `wrangler login` needs a browser. The entry
# finds the package beside itself, since the install is renamed once it is whole.
set -eu

npm install --prefix "$1/package" --no-audit --no-fund "wrangler@4.154.0"
cat >"$1/wrangler" <<'ENTRY'
#!/bin/sh
exec "$(dirname "$0")/package/node_modules/.bin/wrangler" "$@"
ENTRY
chmod 755 "$1/wrangler"
