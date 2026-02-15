# Document Ingestion Pipeline

End-to-end guide for getting documents into the Epstein Investigation Platform — from raw downloads through text extraction, OCR, vector embeddings, and entity extraction.

## Pipeline Overview

```
Download Sources          Processing Pipeline
─────────────────         ─────────────────────────────────────────────────────────
                          ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐
Internet Archive  ───┐    │ 1. INGEST│    │ 2. TEXT   │    │ 4. EMBED │    │5. NEO4J│
Court Records     ───┼──► │ PostgreSQL│──►│ EXTRACT  │──►│ Qdrant   │──►│Extract │
House Oversight   ───┤    │ + S3     │    │          │    │ V2 1536d │    │Entities│
EFTA Dataset      ───┤    └──────────┘    └────┬─────┘    └──────────┘    └───────┘
FBI Vault         ───┘                         │
                                               │ (fails)
                                         ┌─────▼─────┐
                                         │ 3. OCR    │
                                         │ Tesseract │
                                         │ OpenAI    │──── back to step 4
                                         │ CF VLM    │
                                         └───────────┘
```

### Stage Summary

| Stage | Tool | Storage | Speed | Status Field |
|-------|------|---------|-------|-------------|
| 1. Ingest | `import_document()` + rclone | PostgreSQL + Hetzner S3 | ~1000/min | `embedding_status = 'pending'` |
| 2. Text Extract | API backend (pdf-parse) | `metadata->>'text'` | ~530/min (16 workers) | `embedding_status = 'completed'` |
| 3. OCR | Tesseract / OpenAI / CF VLM | `metadata->>'text'` | 18-60/min | `embedding_status = 'needs_ocr'` → `'completed'` |
| 4. Embed | OpenAI text-embedding-3-small | Qdrant V2 (1536d) | ~5000 RPM | `metadata->>'embedding_v2' = 'completed'` |
| 5. Entities | Cerebras LLM → Neo4j | Neo4j graph | ~300-1400/min | `metadata->>'entities_extracted' = 'true'` |

---

## Stage 1: Document Ingestion

### What It Does
Takes raw files (PDFs, images, ZIPs) and creates a record in PostgreSQL with a unique content hash for deduplication, then uploads the file to Hetzner S3 object storage.

### Deduplication
Every document gets an MD5 content hash. The `import_document()` function checks for duplicates before inserting:

```sql
SELECT * FROM import_document(
  'filename.pdf',       -- filename
  'source-name',        -- source
  'md5_content_hash',   -- content_hash (MD5 of file bytes)
  'path/in/s3/file.pdf',-- r2_key (Hetzner S3 key)
  'Court Filing',       -- doc_type
  12345,                -- file_size_bytes
  '{}'::jsonb           -- metadata
);
-- Returns: (doc_id UUID, status TEXT) → 'inserted' or 'duplicate'
```

### Ingestion Scripts

| Script | Purpose | Sources |
|--------|---------|---------|
| `processing/process_all_downloads.py` | Multi-source batch ingestion | House Oversight PDFs, IA OCR ZIPs, court records, EFTA |
| `processing/ingest_court_records.py` | Court case documents | Giuffre v Maxwell, USVI v JPMorgan, US v Epstein/Maxwell, FBI Vault |
| `processing/process_gdrive_local.py` | House Oversight GDrive | IMAGES/DATA/NATIVES/TEXT ZIPs with pre-extracted OCR matching |

### Running Ingestion

```bash
# Multi-source batch
ssh root@88.99.61.233 'cd /opt/app && PYTHONUNBUFFERED=1 python3 processing/process_all_downloads.py'

# Court records (all)
ssh root@88.99.61.233 'cd /opt/app && python3 processing/ingest_court_records.py'

# Court records (specific source)
ssh root@88.99.61.233 'cd /opt/app && python3 processing/ingest_court_records.py giuffre-v-maxwell'

# GDrive (processes TEXT ZIPs first for pre-extracted OCR, then images)
ssh root@88.99.61.233 'cd /opt/app && PYTHONUNBUFFERED=1 python3 processing/process_gdrive_local.py'
```

### Manual Single-File Ingestion

```bash
# 1. Compute hash
md5sum /path/to/file.pdf

# 2. Upload to S3
rclone copyto /path/to/file.pdf hetzner:epstein-documents/custom-source/file.pdf --quiet

# 3. Import to PostgreSQL
docker exec postgres psql -U investigation -d platform -c "
SELECT * FROM import_document(
  'file.pdf', 'custom-source', 'md5hash', 'custom-source/file.pdf', 'Court Filing', 12345, '{}'
)"
```

### Data Sources

| Source | Documents | Type | Download Method |
|--------|-----------|------|----------------|
| `dataset_1` through `dataset_11` | ~960K | PDFs, ZIPs | Internet Archive CLI (`ia download`) |
| `house-oversight-gdrive` | ~23K | JPG/TIF scans | Google Drive ZIPs |
| `house-oversight-ocr` | ~10K | Image-based PDFs | House Oversight website |
| `giuffre-v-maxwell` | ~2K | Court filings | Direct download |
| `epstein-archive` | ~700 | Mixed | Various |
| `efta-20251231-dataset-8` | ~350 | Mixed | EFTA dataset |
| `epstein-docs` / `epstein-docs-fulltext` | ~10K | JSON metadata | Pre-processed summaries |

### Key Details
- **S3 storage**: Hetzner Object Storage (`hetzner:epstein-documents/`), accessed via rclone
- **File types**: PDF, JPG, JPEG, TIF, TIFF, DOC, DOCX, XLS, XLSX, MP4, M4A (audio/video = metadata only)
- **Null bytes**: Strip `\x00` from all text before PostgreSQL JSONB storage
- **Zero-size files**: Auto-marked as completed (no text to extract)
- **Downloads directory**: `/opt/app/data/downloads/` on server

---

## Stage 2: Text Extraction

### What It Does
Fetches PDFs from Hetzner S3, extracts text using pdf-parse via the API backend containers, stores text in `metadata->>'text'`. Documents that fail (image-based PDFs) are marked `needs_ocr`.

### Architecture
Four API backend containers handle extraction, load-balanced by nginx:

```
Worker (extract_court_records.py)
  → Claims batch via FOR UPDATE SKIP LOCKED
  → Downloads PDF via rclone cat from Hetzner S3
  → Sends base64 PDF to API backend
  → Backend returns: text, needsOcr flag, pageCount
  → Stores text in metadata, updates embedding_status
```

### Claiming Pattern
Documents are claimed atomically to prevent double-processing across parallel workers:

```sql
WITH claimed AS (
    SELECT id FROM documents
    WHERE embedding_status = 'pending'
      AND r2_key IS NOT NULL
      AND file_size_bytes > 0
      AND file_size_bytes < 20000000
    ORDER BY file_size_bytes ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
)
UPDATE documents d SET embedding_status = 'processing'
FROM claimed c WHERE d.id = c.id
RETURNING d.id, d.r2_key, d.source, d.filename, d.file_size_bytes;
```

### Running Workers

```bash
# Start 16 workers (max, matches server cores)
ssh root@88.99.61.233 'cd /opt/app && source .env && for i in $(seq 1 16); do
  WORKER_ID=$i BATCH_SIZE=25 PYTHONUNBUFFERED=1 nohup python3 processing/extract_court_records.py > logs/extract-w$i.log 2>&1 &
done && echo "Started 16 workers"'

# Stop all workers
ssh root@88.99.61.233 'pkill -f "extract_court_records.py"'

# Check running workers
ssh root@88.99.61.233 'pgrep -c "extract_court_records" || echo "0"'
```

### Throughput
- **1-4 workers**: ~100-250 docs/min
- **8 workers**: ~250 docs/min
- **16 workers**: ~530 docs/min (optimal for 16-core server)
- Bottleneck: S3 download + pdf-parse, not database

### Output Status
- **Success**: `embedding_status = 'completed'`, text in `metadata->>'text'`
- **Image PDF**: `embedding_status = 'needs_ocr'` (goes to Stage 3)
- **Error**: `embedding_status = 'error'`, error details in `metadata->>'extract_error'`

### Two Text Fields
For historical reasons, text is stored in two fields:
- `metadata->>'text'` — primary field, used by all downstream stages
- `metadata->>'extracted_text'` — duplicate for compatibility

Entity extraction checks both fields as a fallback.

---

## Stage 3: OCR (Optical Character Recognition)

### What It Does
Processes documents that failed text extraction — image-based PDFs and scanned images (JPG/TIF). Uses a tiered approach: Tesseract (free, fast, local) first, then AI vision models for failures.

### Three OCR Approaches

| Method | Script | Speed | Best For |
|--------|--------|-------|----------|
| Tesseract | `ocr_fast.py` | ~60/min | Clear printed text |
| OpenAI GPT-4o-mini | `ocr_openai.py` | ~80/min (pure), ~18/min (with VLM fallback) | Most documents |
| Cloudflare VLM (Llama 3.2 11B) | `ocr_gdrive_images.py`, fallback in `ocr_openai.py` | ~10/min | OpenAI-refused content |

### OCR Strategy: `ocr_openai.py` (Recommended)

1. Resize image to 1024px max dimension, encode as JPEG base64
2. Send to OpenAI GPT-4o-mini vision API (`detail: "low"` for speed)
3. If OpenAI refuses (content moderation), fall back to Cloudflare VLM
4. Save extracted text to `metadata->>'text'` and mark `embedding_status = 'completed'`
5. Images with genuinely no text still get marked completed

```bash
# Start OCR in screen session (persists across SSH disconnects)
ssh root@88.99.61.233 "screen -dmS ocr bash -c 'cd /opt/app && python3 -u processing/ocr_openai.py --workers 8 > /opt/app/logs/ocr_openai.log 2>&1'"

# Check progress
ssh root@88.99.61.233 "grep 'Progress:' /opt/app/logs/ocr_openai.log | tail -3"

# Stop OCR
ssh root@88.99.61.233 "screen -S ocr -X quit; pkill -f ocr_openai"
```

### OCR Strategy: `ocr_fast.py` (Tesseract-First)

Two-phase approach:
1. **Phase 1**: Tesseract (12 workers, fast, parallel) — handles ~90% of clear printed text
2. **Phase 2**: Cloudflare VLM fallback for images where Tesseract extracts < 50 chars

```bash
# With VLM fallback
ssh root@88.99.61.233 "cd /opt/app && nohup python3 -u processing/ocr_fast.py --tesseract-workers 12 --vlm-workers 4 > logs/ocr_fast.log 2>&1 &"

# Tesseract only (skip VLM)
ssh root@88.99.61.233 "cd /opt/app && nohup python3 -u processing/ocr_fast.py --tesseract-workers 12 --skip-vlm > logs/ocr_fast.log 2>&1 &"
```

### House Oversight GDrive Images
These ~23K JPG/TIF scans are stored in 40 ZIP files at `/opt/app/data/downloads/house-oversight-gdrive/IMAGES-*.zip`. OCR scripts read directly from ZIPs (no extraction needed) to avoid doubling disk usage.

Image types found:
- **Document scans**: Emails, letters, legal docs — text extractable
- **Label/placeholder images**: Just the document ID stamped on them (e.g., "HOUSE_OVERSIGHT_022428")
- **Photographs**: Buildings, locations — minimal or no text

### House Oversight OCR PDFs and Epstein Archive
These ~11K documents are image-based PDFs stored in Hetzner S3. They require:
1. Download PDF from S3 via boto3
2. Convert pages to JPEG (pdf2image + poppler)
3. Send to VLM for OCR

Script: `processing/vlm-batch/cloudflare_ocr.py`

```bash
ssh root@88.99.61.233 'cd /opt/app && source .env && PYTHONUNBUFFERED=1 nohup python3 processing/vlm-batch/cloudflare_ocr.py --continuous --workers 2 > logs/ocr.log 2>&1 &'
```

---

## Stage 4: Vector Embeddings (Qdrant)

### What It Does
Takes documents with extracted text, generates vector embeddings using OpenAI's text-embedding-3-small model, and upserts them to Qdrant for semantic search.

### Two Collections

| Collection | Dimensions | Model | Status |
|------------|-----------|-------|--------|
| `document_embeddings` | 768 | BGE-base-en-v1.5 (Cloudflare) | Legacy V1 |
| `document_embeddings_v2` | 1536 | text-embedding-3-small (OpenAI) | **Active** |

### Chunking Strategy
- **Chunk size**: 6,000 characters
- **Overlap**: 500 characters
- **Max chunks per doc**: 20
- Each chunk gets its own embedding and Qdrant point

### Docker Container

```bash
# Start embedding workers
ssh root@88.99.61.233 'cd /opt/app && docker compose -f docker-compose.processing.yml up -d embedding-generator'

# Stop
ssh root@88.99.61.233 'docker stop embedding-generator'

# Logs
ssh root@88.99.61.233 'docker logs --tail 50 embedding-generator'
```

### Rate Limits
- **Tier 1**: 500 RPM → 1-2 workers sufficient
- **Tier 2**: 5,000 RPM → can scale to more workers
- Worker auto-claims documents via `FOR UPDATE SKIP LOCKED`

### Qdrant Point Payload

```json
{
    "document_id": "uuid",
    "filename": "document.pdf",
    "source": "dataset_9",
    "chunk_index": 0,
    "total_chunks": 3,
    "start_char": 0,
    "end_char": 6000,
    "text_preview": "First 200 chars...",
    "embedding_model": "text-embedding-3-small",
    "indexed_at": "2026-02-05T12:00:00Z"
}
```

### Check Progress

```bash
# Qdrant point count
ssh root@88.99.61.233 'source /opt/app/.env && curl -s -H "api-key: $QDRANT_API_KEY" http://localhost:6333/collections/document_embeddings_v2 | jq .result.points_count'

# PostgreSQL progress
ssh root@88.99.61.233 "docker exec postgres psql -U investigation -d platform -c \"
SELECT COUNT(CASE WHEN metadata->>'embedding_v2'='completed' THEN 1 END) as done,
       COUNT(*) as total
FROM documents WHERE metadata->>'text' IS NOT NULL\""
```

---

## Stage 5: Entity Extraction (Neo4j)

### What It Does
Extracts people, organizations, and locations from document text using Cerebras LLM (llama-4-scout-17b), then stores entities and relationships in the Neo4j graph database.

### Extraction Flow
1. Claim documents with text > 100 chars (checks both `text` and `extracted_text` fields)
2. Send text to Cerebras API with JSON extraction prompt
3. Parse response for people, organizations, locations
4. Upsert entities to Neo4j with `MERGE` (dedup by normalized name)
5. Create `MENTIONED_IN` relationships to source documents
6. Mark document: `metadata->>'entities_extracted' = 'true'`

### Neo4j Node Types

| Label | Count (approx) | Properties |
|-------|----------------|-----------|
| Document | 566K | id, filename, type, source |
| Person | 217K | id, name, aliases |
| Organization | 128K | id, name, type |
| Location | 73K | id, name, type |

### Docker Container

```bash
# Start
ssh root@88.99.61.233 'cd /opt/app && docker compose -f docker-compose.processing.yml up -d entity-extractor entity-extractor-2'

# Stop
ssh root@88.99.61.233 'docker stop entity-extractor entity-extractor-2'

# Logs
ssh root@88.99.61.233 'docker logs --tail 20 entity-extractor'
```

### Check Progress

```bash
# Neo4j entity counts
ssh root@88.99.61.233 'source /opt/app/.env && docker exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "MATCH (n) RETURN labels(n)[0], count(*) ORDER BY count(*) DESC"'

# PostgreSQL extraction progress
ssh root@88.99.61.233 "docker exec postgres psql -U investigation -d platform -c \"
SELECT COUNT(CASE WHEN metadata->>'entities_extracted'='true' THEN 1 END) as done,
       COUNT(CASE WHEN metadata->>'entities_error' IS NOT NULL THEN 1 END) as errors,
       COUNT(*) as eligible
FROM documents
WHERE (metadata->>'text' IS NOT NULL AND LENGTH(metadata->>'text') > 100)
   OR (metadata->>'extracted_text' IS NOT NULL AND LENGTH(metadata->>'extracted_text') > 100)\""
```

### Key Details
- Uses Cerebras API (fast, cheap inference) — can hit 402 if credits exhausted
- JSON fallback parser handles malformed LLM responses (balanced brace matching)
- Two concurrent extractor containers share work via `FOR UPDATE SKIP LOCKED`
- Throughput varies: ~1,400/min at peak, ~300/min under rate limits

---

## Document Status Lifecycle

```
pending ──► processing ──► completed ──► (embedding_v2) ──► (entities_extracted)
                │
                ├──► needs_ocr ──► (OCR) ──► completed
                │
                └──► error
```

### Status Field: `embedding_status`

| Value | Meaning | Next Step |
|-------|---------|-----------|
| `pending` | Ingested, awaiting text extraction | Start text extraction workers |
| `processing` | Claimed by a worker | Wait (or reset if stuck > 30 min) |
| `completed` | Text extracted successfully | Ready for embedding + entities |
| `needs_ocr` | Image-based, text extraction failed | Run OCR pipeline |
| `error` | Processing failed permanently | Investigate (usually audio/video) |

### Metadata Status Fields

| Field | Values | Stage |
|-------|--------|-------|
| `metadata->>'text'` | Extracted text | Stage 2/3 |
| `metadata->>'text_source'` | `tesseract`, `openai_gpt4o_mini`, `cloudflare_vlm_ocr`, etc. | Stage 3 |
| `metadata->>'embedding_v2'` | `completed` | Stage 4 |
| `metadata->>'entities_extracted'` | `true` | Stage 5 |
| `metadata->>'entities_error'` | Error message | Stage 5 (failed) |

---

## Monitoring

### Full Pipeline Status

```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as text_done,
  COUNT(CASE WHEN embedding_status = 'pending' THEN 1 END) as pending,
  COUNT(CASE WHEN embedding_status = 'needs_ocr' THEN 1 END) as needs_ocr,
  COUNT(CASE WHEN embedding_status = 'error' THEN 1 END) as errors,
  COUNT(CASE WHEN metadata->>'embedding_v2' = 'completed' THEN 1 END) as embedded,
  COUNT(CASE WHEN metadata->>'entities_extracted' = 'true' THEN 1 END) as entities_done
FROM documents;
```

### Progress by Source

```sql
SELECT source, COUNT(*) as total,
  COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as text_done,
  COUNT(CASE WHEN embedding_status = 'needs_ocr' THEN 1 END) as needs_ocr,
  COUNT(CASE WHEN embedding_status = 'pending' THEN 1 END) as pending
FROM documents GROUP BY source ORDER BY total DESC;
```

### Running Workers

```bash
# All processing workers
ssh root@88.99.61.233 'pgrep -af "extract_court\|cloudflare_ocr\|ocr_openai\|ocr_fast\|embed\|entity"'

# Docker processing containers
ssh root@88.99.61.233 'docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "entity|embedding|extract|ocr"'
```

---

## Error Handling

### Principles
- **Never reset errors to `pending`** — causes infinite retry loops
- Mark failures as `embedding_status = 'error'` with error details in metadata
- Audio/video files (mp4, m4a, opus, etc.) are expected errors — no text to extract
- Use `FOR UPDATE SKIP LOCKED` to prevent claiming conflicts between workers

### Reset Stuck Documents

```sql
-- Documents stuck in 'processing' for > 30 minutes
UPDATE documents SET embedding_status = 'pending'
WHERE embedding_status = 'processing'
  AND processed_at < NOW() - INTERVAL '30 minutes';
```

### Common Error Causes

| Error | Count | Action |
|-------|-------|--------|
| Audio/video files | ~800 | Expected, ignore |
| PDF parse failures | ~400 | Mark `needs_ocr`, run OCR |
| Network timeouts | varies | Auto-retry handles these |
| Zero-size files | varies | Auto-marked completed |

---

## Server Details

- **Server**: Hetzner AX42, 16 cores, Falkenstein Germany
- **SSH**: `ssh root@88.99.61.233`
- **Working directory**: `/opt/app/`
- **Secrets**: `/opt/app/.env`
- **Downloads**: `/opt/app/data/downloads/`
- **Logs**: `/opt/app/logs/`
- **Processing scripts**: `/opt/app/processing/`

### Storage

| Service | Location | Size |
|---------|----------|------|
| PostgreSQL | `/opt/app/data/postgres/` | ~20G allocated |
| Qdrant | `/opt/app/data/qdrant/` | ~24G allocated |
| Neo4j | `/opt/app/data/neo4j/` | ~14G allocated |
| Downloads | `/opt/app/data/downloads/` | ~200G (ZIPs + extracted) |
| Hetzner S3 | `hetzner:epstein-documents/` | Remote bucket |

### Key API Keys (from `/opt/app/.env`)
- `API_SECRET_KEY` — Backend API authentication
- `OPENAI_API_KEY` — Embeddings + OCR
- `CEREBRAS_API_KEY` — Entity extraction LLM
- `QDRANT_API_KEY` — Vector database
- `NEO4J_PASSWORD` — Graph database
- `HETZNER_S3_ACCESS_KEY` / `HETZNER_S3_SECRET_KEY` — Object storage

---

## Processing Status (as of 2026-02-14)

| Metric | Count | % |
|--------|-------|---|
| Total Documents | 1,475,212 | 100% |
| Text Extracted | 1,442,221 | 97.8% |
| Needs OCR | ~19,000 | 1.3% |
| Errors | ~1,243 | 0.1% |
| Qdrant V2 Embeddings | 1,672,802 points | Complete |
| Neo4j Entities | 566K docs, 217K people, 128K orgs, 73K locations | ~38.5% |
