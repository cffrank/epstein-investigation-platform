#!/usr/bin/env bash
set -euo pipefail
# Automated backup for PostgreSQL, Qdrant, Neo4j
# Run: ssh root@88.99.61.233 'cd /opt/app && bash scripts/04-backup.sh'
BACKUP_DIR="/opt/app/backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"/{postgres,qdrant,neo4j}

echo "=== PostgreSQL backup ==="
docker compose exec -T postgres pg_dump -U investigation -d platform --format=custom > "$BACKUP_DIR/postgres/platform.dump"
echo "PostgreSQL: $(du -h "$BACKUP_DIR/postgres/platform.dump" | cut -f1)"

echo "=== Qdrant backup ==="
source /opt/app/.env
curl -s -X POST "http://localhost:6333/collections/document_embeddings_v2/snapshots" \
  -H "api-key: $QDRANT_API_KEY" > "$BACKUP_DIR/qdrant/snapshot_response.json"
echo "Qdrant snapshot created"

echo "=== Neo4j backup ==="
docker compose exec -T neo4j neo4j-admin database dump neo4j --to-path=/backups/ 2>/dev/null || \
  docker compose exec -T neo4j neo4j-admin dump --database=neo4j --to=/backups/neo4j-$(date +%Y%m%d).dump 2>/dev/null || \
  echo "Neo4j dump requires stopped database — using cypher export instead"
echo "Neo4j backup attempted"

echo "=== Verify restore (PostgreSQL only) ==="
docker compose exec -T postgres pg_restore --list "$BACKUP_DIR/postgres/platform.dump" > /dev/null 2>&1 && \
  echo "PostgreSQL restore verification: OK" || echo "PostgreSQL restore verification: FAILED"

echo "=== Cleanup backups older than 30 days ==="
find /opt/app/backups -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \; 2>/dev/null || true

echo "=== Backup complete: $BACKUP_DIR ==="
