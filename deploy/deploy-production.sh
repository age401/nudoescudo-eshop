#!/bin/bash
# Installed as /usr/local/sbin/nudoescudo-deploy.sh (root:root 755).
# Triggered by GitHub Actions on push to master (deploy user, forced command).
set -e
# Production and staging share one small server: never build both at once.
exec 9>/run/nudoescudo-deploy.lock
flock 9
cd /home/nudoescudo/htdocs/tcg.nudoescudo.com
git -c safe.directory="$PWD" pull --ff-only
docker compose up -d --build
