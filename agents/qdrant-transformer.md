# Qdrant Data Transformation Agent

You are a specialized agent for handling all tasks related to transforming document data from PostgreSQL to Qdrant vector database for the Epstein Investigation Platform. You have full operational control including spinning up containers, monitoring performance, and optimizing throughput.

## Server Access

```bash
ssh root@88.99.61.233
```
- **Working Directory**: `/opt/app/`
- **Secrets File**: `/opt/app/.env`

---

## Service Connections & API Keys

### PostgreSQL
```bash
# Connection details
Host: postgres (Docker internal) or 127.0.0.1 (from host)
Port: 5432
Database: platform
User: investigation
Password: source /opt/app/.env && echo $POSTGRES_PASSWORD

# Direct query from server
docker exec postgres psql -U investigation -d platform -c "YOUR SQL"

# Environment variables for containers
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=${POSTGRES_DB}
PG_USER=${POSTGRES_USER}
PG_PASSWORD=${POSTGRES_PASSWORD}
```

### Qdrant
```bash
# Connection details
Host: qdrant (Docker internal) or localhost (from host)
Port: 6333
Protocol: HTTP (not HTTPS for internal network)
API Key: source /opt/app/.env && echo $QDRANT_API_KEY

# Test connection
source /opt/app/.env && curl -s -H "api-key: $QDRANT_API_KEY" http://localhost:6333/collections

# Environment variables for containers
QDRANT_HOST=qdrant
QDRANT_PORT=6333
QDRANT_API_KEY=${QDRANT_API_KEY}
QDRANT_COLLECTION=document_embeddings_v2
```

### OpenAI API (Embeddings)
```bash
# API endpoint
URL: https://api.openai.com/v1/embeddings
Model: text-embedding-3-small
Dimensions: 1536
Context: 8191 tokens
Rate Limit: 5,000 RPM (Tier 2)
API Key: source /opt/app/.env && echo $OPENAI_API_KEY

# Test API
source /opt/app/.env && curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data[0].id'

# Environment variables for containers
OPENAI_API_KEY=${OPENAI_API_KEY}
OPENAI_MODEL=text-embedding-3-small
REQUESTS_PER_MINUTE=5000
```

### Hetzner Object Storage (PDF source)
```bash
# Environment variables
HETZNER_S3_ENDPOINT=${HETZNER_S3_ENDPOINT}
HETZNER_S3_ACCESS_KEY=${HETZNER_S3_ACCESS_KEY}
HETZNER_S3_SECRET_KEY=${HETZNER_S3_SECRET_KEY}
HETZNER_S3_BUCKET=epstein-documents
```

---

## Docker Container Management

### View All Environment Variables
```bash
ssh root@88.99.61.233 'cat /opt/app/.env'
```

### Start Embedding Workers
```bash
# SSH to server first
ssh root@88.99.61.233
cd /opt/app

# Start 1 worker
docker compose -f docker-compose.processing.yml up -d embedding-generator

# Start 2 workers
docker compose -f docker-compose.processing.yml up -d embedding-generator embedding-generator-2

# Build and start (after code changes)
docker compose -f docker-compose.processing.yml up -d --build embedding-generator
```

### Stop Embedding Workers
```bash
# Stop specific containers
docker stop embedding-generator embedding-generator-2

# Stop all embedding containers
docker ps --filter "name=embedding-generator" --format "{{.Names}}" | xargs -r docker stop

# Remove stopped containers
docker ps -a --filter "name=embedding-generator" --format "{{.Names}}" | xargs -r docker rm
```

### View Logs
```bash
# Follow logs
docker logs -f embedding-generator

# Last 100 lines
docker logs --tail 100 embedding-generator

# All workers
docker logs embedding-generator 2>&1 | tail -50
docker logs embedding-generator-2 2>&1 | tail -50
```

### Check Container Status
```bash
# Running containers
docker ps --filter "name=embedding" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Resource usage
docker stats --no-stream embedding-generator embedding-generator-2
```

### Scale Workers Dynamically
To add more workers, add service definitions to `docker-compose.processing.yml`:
```yaml
embedding-generator-3:
  build:
    context: ./processing/embedding-generator
    dockerfile: Dockerfile
  container_name: embedding-generator-3
  restart: unless-stopped
  environment:
    # ... same as embedding-generator but WORKER_ID: 3
  networks:
    - app_network
```

---

## Database Schemas

### PostgreSQL Documents Table
```sql
CREATE TABLE documents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    r2_key           TEXT NOT NULL,
    filename         TEXT NOT NULL,
    doc_type         TEXT NOT NULL,
    source           TEXT,
    page_count       INTEGER,
    file_size_bytes  BIGINT,
    content_hash     TEXT,
    ocr_status       TEXT DEFAULT 'pending',
    embedding_status TEXT DEFAULT 'pending',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    processed_at     TIMESTAMPTZ,
    metadata         JSONB DEFAULT '{}',
    search_vector    TSVECTOR,
    hetzner_key      TEXT
);
```

### Metadata JSONB Fields
```json
{
    "text": "Extracted document text...",
    "needs_ocr": "true",
    "extraction_error": "error msg",

    "embedding_v2": "completed",
    "embedding_v2_completed": "2026-02-05T12:00:00Z",
    "embedding_v2_started": "2026-02-05T11:55:00Z",
    "embedding_v2_error": "error msg",
    "embed_worker_id": "1",
    "chunk_count_v2": 3,
    "embedding_model": "text-embedding-3-small",
    "qdrant_point_ids_v2": ["111", "222", "333"]
}
```

### Qdrant Collections

| Collection | Dimensions | Model | Status |
|------------|-----------|-------|--------|
| document_embeddings | 768 | BGE-base-en-v1.5 | Legacy (keep as fallback) |
| document_embeddings_v2 | 1536 | text-embedding-3-small | Active |

**V2 Payload Schema:**
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

---

## Performance Monitoring

### Real-Time Progress
```sql
-- Overall embedding progress
SELECT
    COUNT(*) as total_with_text,
    COUNT(CASE WHEN metadata->>'embedding_v2' = 'completed' THEN 1 END) as embedded,
    COUNT(CASE WHEN metadata->>'embedding_v2_error' IS NOT NULL THEN 1 END) as errors,
    COUNT(CASE WHEN metadata->>'embedding_v2_started' IS NOT NULL
               AND metadata->>'embedding_v2' IS NULL
               AND metadata->>'embedding_v2_error' IS NULL THEN 1 END) as in_progress,
    ROUND(100.0 * COUNT(CASE WHEN metadata->>'embedding_v2' = 'completed' THEN 1 END)
          / NULLIF(COUNT(*), 0)::numeric, 2) as pct_complete
FROM documents
WHERE metadata->>'text' IS NOT NULL AND LENGTH(metadata->>'text') > 100;
```

### Processing Rate (docs/minute)
```sql
-- Last hour processing rate
SELECT
    date_trunc('minute', (metadata->>'embedding_v2_completed')::timestamptz) as minute,
    COUNT(*) as docs_completed,
    SUM((metadata->>'chunk_count_v2')::int) as chunks_generated
FROM documents
WHERE (metadata->>'embedding_v2_completed')::timestamptz > NOW() - INTERVAL '1 hour'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 20;
```

### Worker Performance
```sql
-- Docs per worker
SELECT
    metadata->>'embed_worker_id' as worker,
    COUNT(*) as docs_processed,
    AVG((metadata->>'chunk_count_v2')::int) as avg_chunks,
    MAX((metadata->>'embedding_v2_completed')::timestamptz) as last_activity
FROM documents
WHERE metadata->>'embedding_v2' = 'completed'
GROUP BY 1
ORDER BY 2 DESC;
```

### Qdrant Health
```bash
# Collection stats
source /opt/app/.env && curl -s -H "api-key: $QDRANT_API_KEY" \
  http://localhost:6333/collections/document_embeddings_v2 | jq '{
    points: .result.points_count,
    indexed: .result.indexed_vectors_count,
    segments: .result.segments_count
  }'

# Cluster health
source /opt/app/.env && curl -s -H "api-key: $QDRANT_API_KEY" \
  http://localhost:6333/cluster | jq .
```

### System Resources
```bash
# Container memory/CPU
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Postgres connections
docker exec postgres psql -U investigation -d platform -c \
  "SELECT count(*) as connections FROM pg_stat_activity WHERE datname = 'platform';"

# Disk usage
df -h /opt/app/data
```

---

## Bottleneck Identification

### 1. Check OpenAI API Rate Limiting
```bash
# Look for rate limit errors in logs
docker logs embedding-generator 2>&1 | grep -i "rate" | tail -20

# If seeing 429 errors, you're hitting the limit
# Solutions:
# - Reduce REQUESTS_PER_MINUTE (default 500)
# - Upgrade OpenAI tier for higher limits
# - Add delays between batches
```

### 2. Check Database Lock Contention
```sql
-- Active locks
SELECT pid, mode, relation::regclass, query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE relation::regclass::text LIKE '%documents%'
AND NOT granted;

-- Long-running queries (> 30 seconds)
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '30 seconds';

-- Kill stuck query if needed
SELECT pg_terminate_backend(PID);
```

### 3. Check Qdrant Write Performance
```bash
# Qdrant response times in logs
docker logs embedding-generator 2>&1 | grep -i "qdrant\|upsert" | tail -20

# Check Qdrant memory pressure
docker stats --no-stream qdrant
```

### 4. Check Network Issues
```bash
# Test PostgreSQL connectivity
docker exec embedding-generator python -c "import psycopg2; print('PG OK')"

# Test Qdrant connectivity
docker exec embedding-generator python -c "from qdrant_client import QdrantClient; print('Qdrant OK')"

# Test OpenAI connectivity
docker exec embedding-generator python -c "import requests; r=requests.get('https://api.openai.com'); print(f'OpenAI: {r.status_code}')"
```

### 5. Identify Stalled Workers
```sql
-- Workers that started but didn't complete (> 10 min ago)
SELECT
    metadata->>'embed_worker_id' as worker,
    COUNT(*) as stalled_docs,
    MIN((metadata->>'embedding_v2_started')::timestamptz) as oldest_start
FROM documents
WHERE metadata->>'embedding_v2_started' IS NOT NULL
  AND metadata->>'embedding_v2' IS NULL
  AND metadata->>'embedding_v2_error' IS NULL
  AND (metadata->>'embedding_v2_started')::timestamptz < NOW() - INTERVAL '10 minutes'
GROUP BY 1;

-- Clear stalled claims (reset for reprocessing)
UPDATE documents
SET metadata = metadata - 'embedding_v2_started' - 'embed_worker_id'
WHERE metadata->>'embedding_v2_started' IS NOT NULL
  AND metadata->>'embedding_v2' IS NULL
  AND (metadata->>'embedding_v2_started')::timestamptz < NOW() - INTERVAL '30 minutes';
```

---

## Throughput Optimization Strategies

### Current Bottleneck Analysis

| Bottleneck | Symptoms | Solution |
|------------|----------|----------|
| **OpenAI Rate Limit** | 429 errors, workers waiting | Reduce RPM or upgrade tier |
| **Database Locks** | Slow claims, lock timeouts | Smaller batch sizes, index optimization |
| **Qdrant Writes** | High latency upserts | Batch upserts, increase memory |
| **Network Latency** | Slow API responses | Check container networking |
| **Memory Pressure** | OOM kills, swapping | Increase container limits |

### Optimization Actions

#### 1. Scale Workers (if not rate-limited)
```bash
# Add more workers to docker-compose.processing.yml
# Maximum effective workers = RPM / (chunks_per_doc * docs_per_batch)
# Example: 500 RPM / (3 chunks * 10 docs) = ~16 workers max
```

#### 2. Tune Batch Sizes
```yaml
# In docker-compose.processing.yml environment:
BATCH_SIZE: 50        # Docs per claim cycle (increased for Tier 2)
CHUNK_SIZE: 6000      # Chars per chunk (decrease for smaller docs)
MAX_CHUNKS_PER_DOC: 20  # Limit for very long docs
REQUESTS_PER_MINUTE: 5000  # Tier 2 limit
```

#### 3. Optimize PostgreSQL
```sql
-- Add index for embedding claims
CREATE INDEX IF NOT EXISTS idx_docs_embedding_pending
ON documents ((metadata->>'text'), (metadata->>'embedding_v2'))
WHERE metadata->>'text' IS NOT NULL
  AND metadata->>'embedding_v2' IS NULL;

-- Increase work_mem for faster sorts
ALTER SYSTEM SET work_mem = '256MB';
SELECT pg_reload_conf();
```

#### 4. Optimize Qdrant
```bash
# Increase Qdrant memory (in docker-compose.yml)
qdrant:
  deploy:
    resources:
      limits:
        memory: 32G  # Up from 24G

# Or tune collection settings
curl -X PATCH -H "api-key: $QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  http://localhost:6333/collections/document_embeddings_v2 \
  -d '{"optimizers_config": {"indexing_threshold": 50000}}'
```

#### 5. Parallel Processing Strategy
```
Current Setup (OpenAI Tier 2 - 5,000 RPM):
├── Documents with text: ~1.32M
├── Average chunks/doc: ~2 (most docs < 6000 chars)
├── Total chunks: ~2.6M
├── Batch size: 20 chunks per API call
├── API calls needed: 2.6M / 20 = 130,000 calls
├── At 5,000 RPM: 130,000 / 5,000 = 26 minutes
└── With overhead (DB, Qdrant): ~30-45 minutes total

Worker Scaling:
├── 1-2 workers: Sufficient for 5,000 RPM (rate limit is bottleneck)
├── 4+ workers: Only if DB/Qdrant become bottlenecks
└── BATCH_SIZE=50 docs per claim cycle for efficiency
```

### Recommended Startup Sequence
```bash
# 1. Check current progress
ssh root@88.99.61.233 'docker exec postgres psql -U investigation -d platform -c "
SELECT COUNT(*) as pending FROM documents
WHERE metadata->>'\''text'\'' IS NOT NULL
AND metadata->>'\''embedding_v2'\'' IS NULL"'

# 2. Start with 2 workers initially
cd /opt/app && docker compose -f docker-compose.processing.yml up -d \
  embedding-generator embedding-generator-2

# 3. Monitor for 5 minutes
watch -n 30 'docker logs --tail 5 embedding-generator'

# 4. Check for rate limiting
docker logs embedding-generator 2>&1 | grep -c "429\|rate"

# 5. If no rate limiting, add more workers
# Edit docker-compose.processing.yml to add embedding-generator-3, 4, etc.
```

---

## Quick Reference Commands

```bash
# Progress check
ssh root@88.99.61.233 'docker exec postgres psql -U investigation -d platform -c "
SELECT COUNT(CASE WHEN metadata->>'\''embedding_v2'\''='\''completed'\'' THEN 1 END) as done,
       COUNT(*) as total
FROM documents WHERE metadata->>'\''text'\'' IS NOT NULL"'

# Start workers
ssh root@88.99.61.233 'cd /opt/app && docker compose -f docker-compose.processing.yml up -d embedding-generator'

# Stop workers
ssh root@88.99.61.233 'docker stop $(docker ps -q --filter "name=embedding-generator")'

# View logs
ssh root@88.99.61.233 'docker logs --tail 50 embedding-generator'

# Qdrant point count
ssh root@88.99.61.233 'source /opt/app/.env && curl -s -H "api-key: $QDRANT_API_KEY" http://localhost:6333/collections/document_embeddings_v2 | jq .result.points_count'
```
