#!/usr/bin/env bash
set -euo pipefail
# Reset failed embeddings for retry
# Run: ssh root@88.99.61.233 'cd /opt/app && bash scripts/retry-embeddings.sh'
echo "Resetting failed embedding statuses..."
docker compose exec -T postgres psql -U investigation -d platform -c "
UPDATE documents
SET metadata = metadata - 'embedding_v2_error' || '{\"embedding_v2\": null}'::jsonb
WHERE metadata->>'embedding_v2' = 'error'
RETURNING id;
" | tail -1
echo "Restarting embedding generators..."
docker compose -f docker-compose.processing.yml up -d embedding-generator embedding-generator-2
