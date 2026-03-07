#!/usr/bin/env bash
set -euo pipefail
# Install weekly backup cron job (idempotent)
CRON_CMD="0 3 * * 0 cd /opt/app && bash scripts/04-backup.sh >> /opt/app/logs/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "04-backup.sh"; echo "$CRON_CMD") | crontab -
echo "Cron job installed: weekly backup at 3am Sunday"
crontab -l | grep backup
