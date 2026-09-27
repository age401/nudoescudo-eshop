#!/bin/bash
# Installed as /usr/local/sbin/nudoescudo-staging-refresh-db.sh. Run as root.
#
# Replaces the staging database with a copy of production: catalog, prices,
# stock, settings and sync history. Orders are NOT copied (they hold real
# customer names and emails, and staging's worker would email them when it
# expires stale orders), and stock reservations are reset to 0 to match.
set -euo pipefail
PROD=/home/nudoescudo/htdocs/tcg.nudoescudo.com
STAGING=/home/nudoescudo/htdocs/staging.tcg.nudoescudo.com

echo "Stopping staging app + worker..."
docker compose --project-directory "$STAGING" stop app worker

echo "Copying production database (without orders)..."
docker compose --project-directory "$STAGING" exec -T db \
  psql -q -U postgres -d nudoescudo -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
docker compose --project-directory "$PROD" exec -T db \
  pg_dump -U postgres -d nudoescudo --no-owner \
  --exclude-table-data=orders --exclude-table-data=order_items \
  | grep -v '^CREATE SCHEMA public;$' \
  | docker compose --project-directory "$STAGING" exec -T db \
    psql -q -U postgres -d nudoescudo -v ON_ERROR_STOP=1 >/dev/null
docker compose --project-directory "$STAGING" exec -T db \
  psql -q -U postgres -d nudoescudo -c "UPDATE stock SET reserved = 0;"

echo "Starting staging again..."
docker compose --project-directory "$STAGING" up -d
echo "Done."
