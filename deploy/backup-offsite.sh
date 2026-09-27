#!/bin/bash
# Installed as /usr/local/sbin/nudoescudo-backup-offsite.sh. Run as root from
# cron, after the nightly dump (the backup container dumps at midnight):
#
#   30 4 * * *  OFFSITE_REMOTE=b2:nudoescudo-backups/prod /usr/local/sbin/nudoescudo-backup-offsite.sh >> /var/log/nudoescudo-offsite.log 2>&1
#
# Copies the dated dumps in backups/{daily,weekly,monthly} to an rclone remote
# (Backblaze B2, Cloudflare R2, Google Drive... configured once with
# `rclone config`). Uses `copy`, never `sync`: nothing is ever deleted
# remotely, so a wiped or compromised server cannot take the off-site copies
# with it. Expire old files with a lifecycle rule on the bucket instead.
#
# On success it writes backups/.offsite-last-ok, which the admin panel shows
# under Respaldos (and flags once it is more than 2 days old).
set -euo pipefail
APP_DIR=${APP_DIR:-/home/nudoescudo/htdocs/tcg.nudoescudo.com}
REMOTE=${OFFSITE_REMOTE:?set OFFSITE_REMOTE, e.g. b2:nudoescudo-backups/prod}
SRC="$APP_DIR/backups"

echo "[$(date -Is)] copying $SRC -> $REMOTE"
rclone copy "$SRC" "$REMOTE" \
  --include "daily/*.sql.gz" --include "weekly/*.sql.gz" --include "monthly/*.sql.gz" \
  --exclude "*-latest*" \
  --immutable --transfers 2 --retries 5 --low-level-retries 10

# Prove the newest daily dump actually arrived with the same size.
NEWEST=$(ls -1t "$SRC"/daily/*.sql.gz | grep -v -- -latest | head -1)
REL="daily/$(basename "$NEWEST")"
LOCAL_SIZE=$(stat -c %s "$NEWEST")
REMOTE_SIZE=$(rclone size --json "$REMOTE/$REL" | sed -E 's/.*"bytes":([0-9]+).*/\1/')
if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
  echo "[$(date -Is)] ERROR: $REL is $LOCAL_SIZE bytes locally but $REMOTE_SIZE remotely" >&2
  exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $REMOTE" > "$SRC/.offsite-last-ok"
echo "[$(date -Is)] ok ($REL, $LOCAL_SIZE bytes)"
