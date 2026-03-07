#!/bin/bash
set -e

DOWNLOAD_DIR="$HOME/epstein-ds11"
EXTRACT_DIR="$DOWNLOAD_DIR/extracted"

# Hetzner S3 credentials - stored in ProtonPass (hetzner-s3-master)
export AWS_ACCESS_KEY_ID="${HETZNER_S3_ACCESS_KEY:?Set HETZNER_S3_ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${HETZNER_S3_SECRET_KEY:?Set HETZNER_S3_SECRET_KEY}"
S3_ENDPOINT="https://fsn1.your-objectstorage.com"
S3_BUCKET="epstein-documents"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log "=== DS11 Download & Upload Script ==="

# Step 1: Create directory
mkdir -p "$DOWNLOAD_DIR"
cd "$DOWNLOAD_DIR"

# Step 2: Download via torrent
log "Downloading Dataset 11 (27.5 GB)..."
aria2c --seed-time=0 --file-allocation=none \
    "magnet:?xt=urn:btih:59975667f8bdd5baf9945b0e2db8a57d52d32957&dn=DataSet%2011.zip&xl=27441913130&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.srv00.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce"

log "Download complete!"

# Step 3: Extract zip
log "Extracting zip file..."
mkdir -p "$EXTRACT_DIR"
unzip -o "DataSet 11.zip" -d "$EXTRACT_DIR"
log "Extraction complete!"

# Count PDFs
PDF_COUNT=$(find "$EXTRACT_DIR" -name "*.pdf" -o -name "*.PDF" | wc -l)
log "Found $PDF_COUNT PDF files"

# Step 4: Upload to Hetzner S3
log "Uploading to Hetzner S3..."
aws s3 sync "$EXTRACT_DIR" "s3://$S3_BUCKET/dataset_11/" \
    --endpoint-url="$S3_ENDPOINT" \
    --no-progress

log "Upload complete!"

# Step 5: Verify upload
UPLOADED=$(aws s3 ls "s3://$S3_BUCKET/dataset_11/" --endpoint-url="$S3_ENDPOINT" --recursive | wc -l)
log "Verified $UPLOADED files in S3"

# Step 6: Cleanup
log "Cleaning up local files..."
rm -f "DataSet 11.zip"
rm -rf "$EXTRACT_DIR"
rmdir "$DOWNLOAD_DIR" 2>/dev/null || true

log "=== DS11 Complete ==="
