#!/usr/bin/env bash
#
# Back up MagnetFlow config & user DB (users.json, .env, aria2.conf,
# rclone.conf). Keeps the most recent $KEEP archives. Run daily from cron.
#
# Env: APP_DIR, BACKUP_DIR, KEEP
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/magnet-flow}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
KEEP="${KEEP:-14}"

mkdir -p "${BACKUP_DIR}"
ts="$(date +%Y%m%d-%H%M%S)"
out="${BACKUP_DIR}/magnetflow-${ts}.tgz"

files=()
for f in "${APP_DIR}/.env" "${APP_DIR}/data/users.json" \
         /root/.aria2/aria2.conf /root/.config/rclone/rclone.conf; do
  [ -f "$f" ] && files+=("$f")
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "$(date '+%F %T') nothing to back up" >> "${BACKUP_DIR}/backup.log"
  exit 0
fi

tar czf "${out}" "${files[@]}" 2>/dev/null
chmod 600 "${out}"

# Prune old backups, keep the newest $KEEP
ls -1t "${BACKUP_DIR}"/magnetflow-*.tgz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "$(date '+%F %T') backup -> ${out} (${#files[@]} files)" >> "${BACKUP_DIR}/backup.log"
