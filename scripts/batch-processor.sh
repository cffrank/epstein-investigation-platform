#!/bin/bash
# Batch document processor - runs on the dedicated server
# Each instance claims and processes documents atomically
# Run multiple instances in parallel: ./batch-processor.sh 1 & ./batch-processor.sh 2 & ...

INSTANCE_ID=${1:-1}
BATCH_SIZE=${2:-25}
WORKER_URL="https://epstein-api.carl-f-frank.workers.dev"
API_KEY="${API_SECRET_KEY:?ERROR: API_SECRET_KEY must be set}"
BACKEND_URL="http://localhost:8080"  # nginx on the server
LOG_FILE="/tmp/batch-processor-${INSTANCE_ID}.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "[$(date '+%H:%M:%S')] [Instance $INSTANCE_ID] $1" | tee -a "$LOG_FILE"
}

process_batch() {
    log "${YELLOW}Claiming $BATCH_SIZE documents...${NC}"

    # Get unprocessed documents from backend (atomic claiming with FOR UPDATE SKIP LOCKED)
    DOCS=$(curl -s "${BACKEND_URL}/api/documents/unprocessed?limit=${BATCH_SIZE}" \
        -H "X-API-Key: ${API_KEY}")

    COUNT=$(echo "$DOCS" | jq '.count // 0')

    if [ "$COUNT" -eq 0 ]; then
        log "No documents to process"
        return 1
    fi

    log "Claimed $COUNT documents"

    COMPLETED=0
    FAILED=0
    NEEDS_OCR=0

    # Process each document
    echo "$DOCS" | jq -c '.documents[]' | while read -r DOC; do
        DOC_ID=$(echo "$DOC" | jq -r '.documentId')
        R2_KEY=$(echo "$DOC" | jq -r '.r2Key')
        FILENAME=$(echo "$DOC" | jq -r '.filename')

        log "Processing: $FILENAME"

        # 1. Extract text using backend container
        EXTRACT_RESULT=$(curl -s -X POST "${BACKEND_URL}/api/extract" \
            -H "Content-Type: application/json" \
            -H "X-API-Key: ${API_KEY}" \
            -d "{\"r2Key\": \"$R2_KEY\", \"documentId\": \"$DOC_ID\"}")

        NEEDS_OCR_FLAG=$(echo "$EXTRACT_RESULT" | jq -r '.needsOcr // false')
        TEXT=$(echo "$EXTRACT_RESULT" | jq -r '.text // ""')
        TEXT_LEN=${#TEXT}

        if [ "$NEEDS_OCR_FLAG" = "true" ]; then
            log "${YELLOW}  → Marked for OCR: $FILENAME${NC}"
            NEEDS_OCR=$((NEEDS_OCR + 1))
            continue
        fi

        if [ "$TEXT_LEN" -lt 100 ]; then
            log "${YELLOW}  → No text extracted: $FILENAME${NC}"
            # Mark as needs_ocr since it likely has no extractable text
            curl -s -X POST "${BACKEND_URL}/api/documents/mark-ocr" \
                -H "Content-Type: application/json" \
                -H "X-API-Key: ${API_KEY}" \
                -d "{\"documentId\": \"$DOC_ID\"}" > /dev/null 2>&1
            NEEDS_OCR=$((NEEDS_OCR + 1))
            continue
        fi

        # 2. Generate embedding via Cloudflare Workers AI
        EMBEDDING_RESULT=$(curl -s -X POST "${WORKER_URL}/ai/embedding" \
            -H "Content-Type: application/json" \
            -H "X-API-Key: ${API_KEY}" \
            -d "{\"text\": $(echo "$TEXT" | head -c 8000 | jq -Rs .)}")

        EMBEDDING=$(echo "$EMBEDDING_RESULT" | jq '.embedding')

        if [ "$EMBEDDING" = "null" ] || [ -z "$EMBEDDING" ]; then
            log "${RED}  → Embedding failed: $FILENAME${NC}"
            # Reset to pending so it can be retried
            curl -s -X POST "${BACKEND_URL}/api/documents/reset" \
                -H "Content-Type: application/json" \
                -H "X-API-Key: ${API_KEY}" \
                -d "{\"documentId\": \"$DOC_ID\"}" > /dev/null 2>&1
            FAILED=$((FAILED + 1))
            continue
        fi

        # 3. Store embedding in Qdrant via backend
        STORE_RESULT=$(curl -s -X POST "${BACKEND_URL}/api/embeddings" \
            -H "Content-Type: application/json" \
            -H "X-API-Key: ${API_KEY}" \
            -d "{\"documentId\": \"$DOC_ID\", \"embedding\": $EMBEDDING}")

        SUCCESS=$(echo "$STORE_RESULT" | jq -r '.success // false')

        if [ "$SUCCESS" = "true" ]; then
            log "${GREEN}  → Completed: $FILENAME${NC}"
            COMPLETED=$((COMPLETED + 1))
        else
            log "${RED}  → Store failed: $FILENAME${NC}"
            FAILED=$((FAILED + 1))
        fi
    done

    log "Batch complete: $COMPLETED completed, $FAILED failed, $NEEDS_OCR need OCR"
    return 0
}

# Main loop
log "Starting batch processor instance $INSTANCE_ID"
log "Batch size: $BATCH_SIZE"
log "Backend URL: $BACKEND_URL"

TOTAL_PROCESSED=0
CONSECUTIVE_EMPTY=0

while true; do
    if process_batch; then
        CONSECUTIVE_EMPTY=0
        TOTAL_PROCESSED=$((TOTAL_PROCESSED + BATCH_SIZE))
        log "Total processed so far: $TOTAL_PROCESSED"
        sleep 1  # Brief pause between batches
    else
        CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
        if [ $CONSECUTIVE_EMPTY -ge 3 ]; then
            log "No more documents to process after 3 consecutive empty batches"
            break
        fi
        log "No documents, waiting 10 seconds..."
        sleep 10
    fi
done

log "Batch processor instance $INSTANCE_ID finished. Total: $TOTAL_PROCESSED"
