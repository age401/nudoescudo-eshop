#!/bin/bash
# Installed as /usr/local/sbin/nudoescudo-deploy-staging.sh (root:root 755).
# Triggered by GitHub Actions on push to staging (deploy user, forced command
# on a second key). Staging is expected to be force-pushed now and then, so
# it resets to origin/staging instead of pulling.
set -e
exec 9>/run/nudoescudo-deploy.lock
flock 9
cd /home/nudoescudo/htdocs/staging.tcg.nudoescudo.com
git -c safe.directory="$PWD" fetch origin staging
git -c safe.directory="$PWD" reset --hard origin/staging
docker compose up -d --build
docker image prune -f >/dev/null
