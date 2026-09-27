#!/bin/bash
# Installed as /usr/local/sbin/nudoescudo-backup-restore-test.sh. Run as root,
# once a month (or after changing anything about backups):
#
#   /usr/local/sbin/nudoescudo-backup-restore-test.sh [path/to/dump.sql.gz]
#
# Proves the newest production dump can actually be restored: loads it into a
# throwaway database ("restore_check") inside the STAGING postgres container,
# compares row counts with live production, and drops it again. Neither
# production nor staging data is touched.
set -euo pipefail
PROD=/home/nudoescudo/htdocs/tcg.nudoescudo.com
STAGING=/home/nudoescudo/htdocs/staging.tcg.nudoescudo.com
DUMP=${1:-$(ls -1t "$PROD"/backups/daily/*.sql.gz | grep -v -- -latest | head -1)}
TABLES="cards printings stock stock_movements orders order_items settings"

sdb() { docker compose --project-directory "$STAGING" exec -T db "$@"; }
pdb() { docker compose --project-directory "$PROD" exec -T db "$@"; }

echo "Restoring $DUMP into staging:restore_check ..."
sdb dropdb -U postgres --if-exists restore_check
sdb createdb -U postgres restore_check
trap 'sdb dropdb -U postgres --if-exists restore_check' EXIT
# A fresh database already has the public schema (same filter as
# staging-refresh-db.sh).
zcat "$DUMP" | grep -v '^CREATE SCHEMA public;$'   | sdb psql -q -U postgres -d restore_check -v ON_ERROR_STOP=1 >/dev/null

printf "\n%-18s %12s %12s\n" table backup live
for t in $TABLES; do
  b=$(sdb psql -U postgres -d restore_check -tAc "select count(*) from $t" 2>/dev/null || echo "MISSING")
  l=$(pdb psql -U postgres -d nudoescudo -tAc "select count(*) from $t")
  printf "%-18s %12s %12s\n" "$t" "$b" "$l"
done
echo
echo "OK: the dump restores. Live counts can be a little higher (changes since the dump)."
