#!/usr/bin/env bash
set -euo pipefail
# Check document processing pipeline status
# Run: ssh root@88.99.61.233 'cd /opt/app && bash scripts/check-processing-status.sh'
docker compose exec -T postgres psql -U investigation -d platform -c "
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as text_extracted,
  COUNT(CASE WHEN metadata->>'embedding_v2' = 'completed' THEN 1 END) as embedded_v2,
  COUNT(CASE WHEN metadata->>'entities_extracted' = 'true' THEN 1 END) as entities_done,
  COUNT(CASE WHEN metadata->>'content_classification' IS NOT NULL THEN 1 END) as classified,
  ROUND(COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END)::numeric / COUNT(*)::numeric * 100, 1) as text_pct,
  ROUND(COUNT(CASE WHEN metadata->>'embedding_v2' = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 1) as embed_pct,
  ROUND(COUNT(CASE WHEN metadata->>'entities_extracted' = 'true' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 1) as entity_pct
FROM documents;
"
