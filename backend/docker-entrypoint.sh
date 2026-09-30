#!/bin/sh
# Container boot: migrate -> (optionally) seed demo cast -> start API.
set -e
node src/db/migrate.js
if [ "$SEED_DEMO_DATA" = "true" ]; then node src/db/seed.js; fi
exec node src/server.js
