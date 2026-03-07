#!/usr/bin/env bash
set -euo pipefail
# Restart entity extraction for remaining documents
# Run: ssh root@88.99.61.233 'cd /opt/app && bash scripts/restart-entity-extraction.sh'
echo "Checking remaining entity extraction work..."
docker compose exec -T postgres psql -U investigation -d platform -c "
SELECT COUNT(*) as remaining FROM documents
WHERE metadata->>'text' IS NOT NULL
AND COALESCE(metadata->>'entities_extracted', 'false') != 'true'
AND COALESCE(metadata->>'entities_error', '') = '';
"
echo "Starting entity extractors..."
docker compose -f docker-compose.processing.yml up -d entity-extractor entity-extractor-2
