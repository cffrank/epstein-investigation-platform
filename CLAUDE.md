# Epstein Investigation Platform - System Configuration

## Remote Server Access

```bash
ssh root@88.99.61.233
```

- **Location:** Hetzner AX42, Falkenstein Germany (FSN1-DC1)
- **Working Directory:** `/opt/app/`
- **Secrets:** `/opt/app/.env`

## Docker Services

All services run via Docker Compose at `/opt/app/docker-compose.yml`:

| Service | Container | Internal Port | Local Bind |
|---------|-----------|---------------|------------|
| PostgreSQL | postgres | 5432 | 127.0.0.1:5432 |
| Qdrant | qdrant | 6333, 6334 | 127.0.0.1:6333 |
| Neo4j | neo4j | 7474 (http), 7687 (bolt) | 127.0.0.1:7474, 7687 |
| Redis | redis | 6379 | 127.0.0.1:6379 |
| OpenClaw | openclaw | 18789 | 127.0.0.1:18789 |
| Nginx | nginx | 80 | 127.0.0.1:8080 |
| Cloudflared | cloudflared | - | Tunnel to Cloudflare |
| Grafana | grafana | 3000 | 127.0.0.1:3001 |
| Prometheus | prometheus | 9090 | 127.0.0.1:9090 |

Additional services (started separately):
- `epstein-api-backend` - REST API on port 3000
- `entity-extraction` - NLP entity extraction

## Database Connections

### PostgreSQL
```
Host: postgres (Docker) or 127.0.0.1 (from host)
Port: 5432
Database: platform
User: investigation
Password: kWn0ZqeRBGw8RVYwEp4KSdS86QqbQTOF
```

Direct query from host:
```bash
docker exec postgres psql -U investigation -d platform -c "YOUR SQL"
```

### Qdrant
```
Host: localhost:6333
API Key: source /opt/app/.env && echo $QDRANT_API_KEY
```

Collections:
- `document_embeddings` (768 dimensions, ~67K vectors)
- `face_embeddings` (512 dimensions, empty)

### Neo4j
```
Bolt: bolt://localhost:7687
HTTP: http://localhost:7474
User: neo4j
Password: source /opt/app/.env && echo $NEO4J_PASSWORD
```

Query from host:
```bash
source /opt/app/.env && docker exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "YOUR CYPHER"
```

## MCP Servers

Config location: `/opt/app/openclaw/config/mcp-servers.json`

Inside OpenClaw container:
- `/opt/mcp-document-search/` - Document search (6 tools)
- `/opt/mcp-intelligence/` - Investigation intelligence (10 tools)

To update MCP servers:
1. Edit files in `/opt/app/mcp-document-search/` or `/opt/app/mcp-intelligence/`
2. Copy into container: `docker cp /opt/app/mcp-document-search openclaw:/opt/`
3. Restart: `cd /opt/app && docker compose restart openclaw`

### MCP Tools Available

**epstein-documents:**
- `search_documents` - Full-text search
- `get_document` - Get document by filename
- `count_person_mentions` - Count docs mentioning person
- `get_person_documents` - Get docs with person context
- `get_database_stats` - Database statistics
- `search_by_date_range` - Search by year range

**epstein-intelligence:**
- `get_subject_intelligence` - Get intel on a person
- `list_all_subjects` - List all subjects
- `add_investigation_note` - Add investigation note
- `update_verification_status` - Update verification
- `check_source_credibility` - Check source rating
- `list_source_credibility` - List all source ratings
- `add_source_rating` - Add/update source rating
- `get_verification_scores` - Get verification scores
- `list_accused_perpetrators` - List accused
- `list_cleared_individuals` - List cleared

## Public Endpoints

Via Cloudflare Tunnel:
- API: `https://epstein-api.allfrontoffice.com`
- Health: `https://epstein-api.allfrontoffice.com/health`
- Stats: `https://epstein-api.allfrontoffice.com/api/stats`

## Key Database Tables

### PostgreSQL (`platform` database)
- `documents` - ~961K documents (main document store)
- `investigation_notes` - Investigation notes by subject
- `source_credibility` - Source credibility ratings
- `allegation_tags` - Document allegation tags

### Document Processing Status
```sql
SELECT source, COUNT(*) as total,
  COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as indexed
FROM documents GROUP BY source ORDER BY total DESC;
```

## Document Deduplication

### How It Works
- Each document has a `content_hash` (MD5 of file content)
- Unique constraint prevents duplicate hashes: `idx_documents_content_hash_unique`
- Datasets tracked via `source` column (e.g., `dataset_9`, `dataset_10`)

### Import Function
Use `import_document()` to safely import with dedup check:
```sql
SELECT * FROM import_document(
  'filename.pdf',      -- filename
  'new_dataset',       -- source
  'abc123hash...',     -- content_hash (MD5)
  'dataset/file.pdf',  -- r2_key
  'Court Filing',      -- doc_type (optional)
  12345,               -- file_size_bytes (optional)
  '{"key": "value"}'   -- metadata JSONB (optional)
);

-- Returns: doc_id UUID, status TEXT ('inserted' or 'duplicate')
```

### Import Workflow
1. Compute MD5 hash of file before upload
2. Call `import_document()` with hash
3. If status = 'duplicate': skip R2 upload, use existing doc_id
4. If status = 'inserted': upload to R2, queue for processing

### Check for Duplicates
```sql
-- Find documents with same content across datasets
SELECT content_hash, array_agg(DISTINCT source) as sources, COUNT(*)
FROM documents
WHERE content_hash IS NOT NULL
GROUP BY content_hash
HAVING COUNT(*) > 1;

-- Check if a hash already exists
SELECT id, filename, source FROM documents WHERE content_hash = 'your_hash';
```

## Cloudflare Worker

Local dev: `/home/carl/project/Epstein/cloudflare-worker/`

Config: `wrangler.toml`
- D1 Database: `epstein-cache` (ea7bdcb5-d8f4-4d6c-8ac4-e9dc3c3075c4)
- R2 Bucket: `epstein-documents`
- KV: `SESSIONS` (eea15de47a4e454ca1079e6a218d26fe)
- Queues: `epstein-document-processing`, `epstein-processing-dlq`

Deploy: `cd cloudflare-worker && npx wrangler deploy`

## Common Commands

```bash
# Check all services
ssh root@88.99.61.233 'docker ps --format "table {{.Names}}\t{{.Status}}"'

# Restart OpenClaw
ssh root@88.99.61.233 'cd /opt/app && docker compose restart openclaw'

# View OpenClaw logs
ssh root@88.99.61.233 'docker logs openclaw --tail 50'

# Test MCP server
ssh root@88.99.61.233 'docker exec openclaw cat /home/node/.openclaw/mcp-servers.json'

# Check document counts
ssh root@88.99.61.233 'docker exec postgres psql -U investigation -d platform -c "SELECT COUNT(*) FROM documents"'

# Check Qdrant vectors
ssh root@88.99.61.233 'source /opt/app/.env && curl -s -H "api-key: $QDRANT_API_KEY" http://localhost:6333/collections/document_embeddings'

# Check Neo4j nodes
ssh root@88.99.61.233 'source /opt/app/.env && docker exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "MATCH (n) RETURN labels(n), count(*)"'
```

## Processing Pipeline Status

As of last check:
- **Total Documents:** 961,433
- **Text Extracted:** 905,738 (94%)
- **Search Indexed:** 71,061 (7%)
- **Qdrant Embeddings:** 66,947 (7%)
- **Neo4j Entities:** 67,653 docs, 88K entities, 917K relationships

Large datasets needing processing:
- `dataset_9`: 477K docs (6% complete)
- `dataset_11`: 329K docs (10% complete)
- `dataset_10`: 141K docs (4% complete)

Metadata-only datasets (JSON, no PDFs):
- `epstein-docs`: 8,186 docs (summaries, key_people, doc classifications)
- `epstein-docs-fulltext`: 1,743 docs (full_text extracts, entities)

## Notes

- PostgreSQL port 5432 is NOT exposed publicly (127.0.0.1 only)
- All external access goes through Cloudflare Tunnel → nginx
- OpenClaw uses Anthropic Claude Opus 4.5 as the agent model
- MCP servers run inside OpenClaw container using stdio transport
- `combined_all` dataset was deleted (redundant, all files existed in dataset_1-8)
- Duplicate detection uses `content_hash` column with unique constraint
