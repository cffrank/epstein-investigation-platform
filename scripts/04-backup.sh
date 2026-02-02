#!/bin/bash
# Epstein Files Investigation Platform
# Script 04: Backup Databases

set -e
source /opt/app/.env

BACKUP_DIR="/opt/app/backups/daily"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== Backup Started: $TIMESTAMP ==="

mkdir -p "$BACKUP_DIR"

echo "Backing up PostgreSQL..."
docker exec postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$BACKUP_DIR/postgres_$TIMESTAMP.dump"

echo "Creating Qdrant Snapshot..."
curl -s -X POST "http://localhost:6333/snapshots" -H "api-key: $QDRANT_API_KEY" > /dev/null

echo "Backing up Neo4j..."
docker exec neo4j neo4j-admin database dump --to-path=/backups neo4j 2>/dev/null || true

echo "Compressing..."
tar -czf "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" . 2>/dev/null || true

# Upload to R2 if configured
if [ -n "$CF_ACCOUNT_ID" ] && [ -n "$R2_ACCESS_KEY" ]; then
    echo "Uploading to R2..."
    aws s3 cp "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" \
        "s3://epstein-documents/backups/" \
        --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com" --quiet
fi

# Cleanup old backups
find "$BACKUP_DIR" -name "*.dump" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

echo "=== Backup Complete ==="
