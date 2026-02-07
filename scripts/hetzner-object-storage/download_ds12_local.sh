#!/bin/bash
set -e

DOWNLOAD_DIR="$HOME/epstein-ds12"
EXTRACT_DIR="$DOWNLOAD_DIR/extracted"

# Hetzner S3 credentials
export AWS_ACCESS_KEY_ID="699EF3OFI3TCI0C819PP"
export AWS_SECRET_ACCESS_KEY="mNTblO15Z7H2uu6w9hb422q6wXszwmrQRThBpeHU"
S3_ENDPOINT="https://fsn1.your-objectstorage.com"
S3_BUCKET="epstein-documents"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log "=== DS12 Download & Upload Script ==="

# Step 1: Create directory
mkdir -p "$DOWNLOAD_DIR"
cd "$DOWNLOAD_DIR"

# Step 2: Download via torrent
log "Downloading Dataset 12 (114 MB)..."
aria2c --seed-time=0 --file-allocation=none \
    "magnet:?xt=urn:btih:e7477151f8acfbaee3e704bbabd9a7388c7169f9&dn=DataSet%2012.zip&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce"

log "Download complete!"

# Step 3: Extract zip
log "Extracting zip file..."
mkdir -p "$EXTRACT_DIR"
unzip -o "DataSet 12.zip" -d "$EXTRACT_DIR"
log "Extraction complete!"

# Count PDFs
PDF_COUNT=$(find "$EXTRACT_DIR" -name "*.pdf" -o -name "*.PDF" | wc -l)
log "Found $PDF_COUNT PDF files"

# Step 4: Upload to Hetzner S3
log "Uploading to Hetzner S3..."
aws s3 sync "$EXTRACT_DIR" "s3://$S3_BUCKET/dataset_12/" \
    --endpoint-url="$S3_ENDPOINT" \
    --no-progress

log "Upload complete!"

# Step 5: Verify upload
UPLOADED=$(aws s3 ls "s3://$S3_BUCKET/dataset_12/" --endpoint-url="$S3_ENDPOINT" --recursive | wc -l)
log "Verified $UPLOADED files in S3"

# Step 6: Cleanup
log "Cleaning up local files..."
rm -f "DataSet 12.zip"
rm -rf "$EXTRACT_DIR"
rmdir "$DOWNLOAD_DIR" 2>/dev/null || true

log "=== DS12 Complete ==="
