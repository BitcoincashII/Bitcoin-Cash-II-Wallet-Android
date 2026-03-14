#!/bin/bash
# Patch electrum-client to enable TLS certificate verification
# The upstream library hardcodes rejectUnauthorized: false which disables MITM protection
CLIENT_JS="node_modules/electrum-client/lib/client.js"
if [ -f "$CLIENT_JS" ]; then
  sed -i 's/{ rejectUnauthorized: false }/{ rejectUnauthorized: (options \&\& options.rejectUnauthorized !== undefined) ? options.rejectUnauthorized : true }/' "$CLIENT_JS"
fi
