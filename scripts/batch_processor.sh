#!/bin/bash
#
# Batch Processor - Runs continuous document processing
#
# Usage:
#   ./batch_processor.sh [WORKER_ID] [BATCH_SIZE]
#
# Environment:
#   Set API endpoint in API_URL (defaults to localhost)
#
# Examples:
#   ./batch_processor.sh 1 25     # Worker 1, 25 docs per batch
#   ./batch_processor.sh 2 50 &   # Worker 2, 50 docs per batch (background)
#

WORKER_ID=${1:-1}
BATCH_SIZE=${2:-25}
API_URL=${API_URL:-http://localhost:3000}
API_KEY=${API_KEY:-test-api-key-12345}

echo "[Worker-$WORKER_ID] Starting batch processor"
echo "[Worker-$WORKER_ID] API: $API_URL"
echo "[Worker-$WORKER_ID] Batch size: $BATCH_SIZE"

processed=0
errors=0

while true; do
    result=$(curl -s -X POST "$API_URL/api/documents/unprocessed?limit=$BATCH_SIZE" \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        2>/dev/null)

    if [ -z "$result" ]; then
        echo "[Worker-$WORKER_ID] Connection error. Waiting 10s..."
        sleep 10
        continue
    fi

    # Parse result
    batch_processed=$(echo "$result" | jq -r '.processed // 0')
    batch_completed=$(echo "$result" | jq -r '.completed // 0')
    batch_failed=$(echo "$result" | jq -r '.failed // 0')

    if [ "$batch_processed" = "0" ] || [ "$batch_processed" = "null" ]; then
        echo "[Worker-$WORKER_ID] No documents. Total: $processed. Waiting 30s..."
        sleep 30
        continue
    fi

    processed=$((processed + batch_completed))
    errors=$((errors + batch_failed))

    echo "[Worker-$WORKER_ID] Batch: $batch_completed completed, $batch_failed failed. Total: $processed"

    # Brief pause between batches
    sleep 1
done
