# Document Processing Pipeline

This directory contains Docker containers for the complete document processing pipeline.

## Architecture

```
[Text Extractor]     [S3 Uploader]     [Embedding Generator]     [Entity Extractor]
      ↓                   ↓                    ↓                       ↓
  PDF → Text          Local → S3         Text → Vector           Text → Entities
  (pdf-parse)        (rclone)           (OpenAI API)            (Cerebras/Neo4j)
      ↓                   ↓                    ↓                       ↓
  PostgreSQL         PostgreSQL            Qdrant                  Neo4j
  (metadata.text)    (r2_key)           (embeddings)          (relationships)
```

## Processing Stages

### 1. Text Extraction (`text-extractor/`)
- Extracts text from PDFs using `pdftotext` (poppler-utils)
- Detects embedded images using `pdfimages` for later face detection
- Stores text in PostgreSQL `documents.metadata->>'text'`
- Updates `search_vector` for full-text search
- Marks PDFs needing OCR (`needs_ocr = true`)
- Marks PDFs with photos (`needs_face_detection = true`)

### 2. S3 Upload (`r2-uploader/`)
- Uploads PDFs to Hetzner Object Storage (S3-compatible)
- **SAFE MODE**: Never deletes local files
- Verifies upload with HEAD request before updating DB
- Updates `r2_key` in PostgreSQL

### 3. Embedding Generation (`embedding-generator/`)
- Generates 1536-dim vectors via OpenAI API
- Uses text-embedding-3-small model
- Respects rate limits (5,000 RPM on Tier 2)
- Stores vectors in Qdrant (`document_embeddings_v2` collection)

### 4. Entity Extraction (`entity-extractor/`)
- Extracts People, Organizations, Locations using Cerebras LLM (llama-4-scout-17b)
- Creates nodes and relationships in Neo4j
- Links entities to documents via `MENTIONED_IN` relationships

## Running with Docker Compose

### Start all processing containers:
```bash
cd /opt/app
docker-compose -f docker-compose.yml -f docker-compose.processing.yml up -d
```

### Start specific containers:
```bash
# Text extraction (4 workers)
docker-compose -f docker-compose.yml -f docker-compose.processing.yml up -d \
  text-extractor text-extractor-2 text-extractor-3 text-extractor-4

# R2 upload (2 workers)
docker-compose -f docker-compose.yml -f docker-compose.processing.yml up -d \
  r2-uploader r2-uploader-2

# Embedding generation (2 workers)
docker-compose -f docker-compose.yml -f docker-compose.processing.yml up -d \
  embedding-generator embedding-generator-2

# Entity extraction (2 workers)
docker-compose -f docker-compose.yml -f docker-compose.processing.yml up -d \
  entity-extractor entity-extractor-2
```

### View logs:
```bash
docker logs -f text-extractor
docker logs -f embedding-generator
```

### Stop all processing:
```bash
docker-compose -f docker-compose.yml -f docker-compose.processing.yml stop \
  text-extractor text-extractor-2 text-extractor-3 text-extractor-4 \
  r2-uploader r2-uploader-2 \
  embedding-generator embedding-generator-2 \
  entity-extractor entity-extractor-2
```

## Environment Variables

Required in `/opt/app/.env`:

```bash
# PostgreSQL
POSTGRES_USER=investigation
POSTGRES_PASSWORD=xxx
POSTGRES_DB=platform

# Qdrant
QDRANT_API_KEY=xxx

# Neo4j
NEO4J_USER=neo4j
NEO4J_PASSWORD=xxx

# Hetzner Object Storage (S3-compatible)
HETZNER_S3_ENDPOINT=xxx
HETZNER_S3_ACCESS_KEY=xxx
HETZNER_S3_SECRET_KEY=xxx
HETZNER_S3_BUCKET=epstein-documents

# OpenAI (Embeddings)
OPENAI_API_KEY=xxx

# Cerebras (Entity Extraction)
CEREBRAS_API_KEY=xxx
```

## Document Metadata Fields

After processing, documents will have these metadata fields:

| Field | Set By | Description |
|-------|--------|-------------|
| `text` | text-extractor | Extracted text content |
| `text_length` | text-extractor | Length of extracted text |
| `page_count` | text-extractor | Number of pages |
| `image_count` | text-extractor | Number of significant images |
| `has_photos` | text-extractor | Boolean - contains photos |
| `needs_face_detection` | text-extractor | Boolean - queue for face detection |
| `needs_ocr` | text-extractor | Boolean - image-based PDF |
| `content_hash` | text-extractor | MD5 hash of file |
| `r2_key` | r2-uploader | R2 object key |
| `r2_file_size` | r2-uploader | File size in bytes |
| `qdrant_point_ids_v2` | embedding-gen | Qdrant vector IDs (V2 collection) |
| `entities_extracted` | entity-extractor | `true` when entities extracted |
| `entity_counts` | entity-extractor | {people, orgs, places} counts |

## Processing Status Fields

| Field | Values | Description |
|-------|--------|-------------|
| `embedding_status` | pending, processing, completed, error | Embedding generation status |
| `search_vector` | tsvector | Full-text search index |

## Querying Processing Status

```sql
-- Overall status
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
  COUNT(CASE WHEN metadata->>'needs_ocr' = 'true' THEN 1 END) as needs_ocr,
  COUNT(CASE WHEN r2_key IS NOT NULL THEN 1 END) as in_r2,
  COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as has_embedding,
  COUNT(CASE WHEN metadata->>'entities_extracted' = 'true' THEN 1 END) as has_entities,
  COUNT(CASE WHEN metadata->>'has_photos' = 'true' THEN 1 END) as has_photos
FROM documents WHERE filename LIKE '%.pdf';

-- By source
SELECT source,
  COUNT(*) as total,
  COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as text_extracted
FROM documents
GROUP BY source
ORDER BY total DESC;

-- Documents needing face detection
SELECT COUNT(*) FROM documents
WHERE metadata->>'needs_face_detection' = 'true';
```

## Throughput Estimates

| Stage | Rate | Bottleneck |
|-------|------|------------|
| Text Extraction | ~530 docs/min (16 workers) | S3 download + pdf-parse |
| S3 Upload | ~1000 docs/min | Network bandwidth |
| Embedding Gen | ~5,000 RPM (Tier 2) | OpenAI rate limit |
| Entity Extract | ~300-1,400 docs/min | Cerebras API / Neo4j writes |

## Atomic Document Claiming

All workers use `FOR UPDATE SKIP LOCKED` for atomic document claiming:

```sql
WITH claimed AS (
    SELECT id FROM documents
    WHERE <conditions>
    ORDER BY created_at ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE documents SET status = 'processing'
FROM claimed WHERE documents.id = claimed.id
RETURNING *;
```

This allows multiple workers to process in parallel without conflicts.

## Building Containers

```bash
# Build all
docker-compose -f docker-compose.yml -f docker-compose.processing.yml build

# Build specific
docker-compose -f docker-compose.yml -f docker-compose.processing.yml build text-extractor
```

## Standalone Scripts

For running outside Docker:

```bash
# Text extraction
cd /opt/app
python3 scripts/process_texts.py

# R2 upload
python3 scripts/upload_safe.py /path/to/pdfs dataset_10

# Embeddings
python3 scripts/generate_embeddings.py --batch-size 10 --continuous
```
