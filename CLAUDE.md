# Epstein Investigation Platform - System Configuration

## Remote Server Access

```bash
ssh root@88.99.61.233
```

- **Location:** Hetzner AX42, Falkenstein Germany (FSN1-DC1)
- **Working Directory:** `/opt/app/`
- **Secrets:** `/opt/app/.env`

## Docker Services

All services run via Docker Compose at `/opt/app/docker-compose.yml`. Network: `app_app_network`.

### Core Services

| Container | Port | Memory | Purpose |
|-----------|------|--------|---------|
| openclaw | 18789 | 2G | **Agent Orchestrator** - Primary AI agent using Claude Opus 4.5 with MCP tools |
| postgres | 5432 | 20G | **Document Store** - 961K+ documents with full-text search, metadata, processing status |
| qdrant | 6333 | 24G | **Vector DB** - Document embeddings for semantic search (768-dim BGE vectors) |
| neo4j | 7687 | 14G | **Graph DB** - Entity relationships (people, orgs, locations from documents) |
| redis | 6379 | 2G | **Cache/Queue** - Session caching and background job queue |

### Infrastructure Services

| Container | Port | Purpose |
|-----------|------|---------|
| nginx | 8080 | **Reverse Proxy** - Routes traffic to OpenClaw gateway and API |
| mcp-http-proxy | 3002 | **MCP HTTP Proxy** - Database access for Claude Code via HTTP |
| cloudflared | - | **Tunnel** - Exposes services via Cloudflare Zero Trust tunnel |
| prometheus | 9090 | **Metrics** - Collects metrics from all services |
| grafana | 3001 | **Dashboards** - Visualization and alerting |
| node-exporter | 9100 | **Host Metrics** - System-level monitoring |

### Container Details

**openclaw** - The AI agent orchestrator:
- Built from `./openclaw/Dockerfile`
- Runs MCP servers internally (stdio transport, no HTTP ports)
- MCP servers: `epstein-documents`, `epstein-intelligence`, `postgres`, `filesystem`
- Config at `/home/node/.openclaw/mcp-servers.json`
- Uses Anthropic API for Claude Opus 4.5

**postgres** - Primary document database (PostgreSQL 16):
- Tables: `documents`, `investigation_notes`, `source_credibility`, `allegation_tags`
- Documents have: text content, embeddings status, R2 key references
- Full-text search via `search_vector` tsvector column
- Deduplication via `content_hash` MD5 column

**qdrant** - Vector similarity search (v1.9.0):
- Collection: `document_embeddings` (768 dimensions from BGE-base-en-v1.5)
- Used for semantic document search and similarity matching
- API key required for access

**neo4j** - Knowledge graph (v5 Community):
- Stores extracted entities: People, Organizations, Locations, Events
- Relationships between documents and entities
- APOC plugin enabled for graph algorithms

**nginx** - Reverse proxy routing:
- `/` → OpenClaw gateway (port 18789)
- `/api/*` → Backend API services
- Health checks for all services

**cloudflared** - Cloudflare Tunnel:
- Exposes to: `https://epstein-api.allfrontoffice.com`
- Zero Trust security with Cloudflare Access
- Routes through nginx for internal distribution

### API Backend Containers (Parallel Processing)

Four backend containers for text extraction and database operations:

| Container | Purpose |
|-----------|---------|
| epstein-api-backend | Primary backend instance |
| epstein-api-backend-2 | Additional worker |
| epstein-api-backend-3 | Backup worker |
| epstein-api-backend-4 | Backup worker |

- All connect to postgres, qdrant, neo4j, and R2
- Nginx load balances across them using `least_conn`
- Atomic document claiming via `FOR UPDATE SKIP LOCKED`
- Routes: `/api/*` → upstream `api_backends`

**Start all backend containers:**
```bash
docker-compose up -d --build epstein-api-backend epstein-api-backend-2 epstein-api-backend-3 epstein-api-backend-4
docker-compose restart nginx
```

### Entity Extraction (planned)

**entity-extraction** (NLP pipeline):
- Extracts people, organizations, locations from document text
- Uses spaCy NER models
- Feeds extracted entities into Neo4j

## Database Connections

### PostgreSQL
```
Host: postgres (Docker) or 127.0.0.1 (from host)
Port: 5432
Database: platform
User: investigation
Password: See /opt/app/.env on server
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

## Project Directory Structure

### Local Development (`/home/carl/project/Epstein/`)
```
├── CLAUDE.md                    # This file - system documentation
├── docker-compose.yml           # Main Docker Compose configuration
├── cloudflare-worker/           # Cloudflare Workers code
│   ├── src/index.ts            # Main Worker API
│   ├── src/workflow.ts         # Workflow definitions
│   ├── wrangler.toml           # Wrangler config
│   └── api-backend/            # Node.js backend API
│       └── index.js            # Backend server
├── config/                      # Configuration files
│   ├── nginx/                  # Nginx configs
│   │   ├── nginx.conf
│   │   └── conf.d/default.conf
│   ├── postgres/               # PostgreSQL configs
│   ├── prometheus/             # Prometheus configs
│   └── grafana/                # Grafana dashboards
├── openclaw/                    # OpenClaw agent config
│   ├── Dockerfile
│   └── config/mcp-servers.json
├── scripts/                     # Setup and maintenance scripts
│   ├── 01-base-setup.sh
│   ├── 02-generate-secrets.sh
│   ├── 03-cloudflare-setup.sh
│   ├── 04-backup.sh
│   └── 05-health-check.sh
├── data/                        # Persistent data (gitignored)
├── logs/                        # Log files
└── backups/                     # Backup storage
```

### Remote Server (`/opt/app/`)
```
├── docker-compose.yml           # Same as local
├── .env                         # Environment secrets (DO NOT COMMIT)
├── config/                      # Same structure as local
├── data/
│   ├── postgres/               # PostgreSQL data
│   ├── qdrant/                 # Qdrant vectors
│   ├── neo4j/                  # Neo4j graph data
│   └── redis/                  # Redis persistence
├── logs/
│   ├── nginx/
│   └── neo4j/
└── backups/
    ├── postgres/
    ├── qdrant/
    └── neo4j/
```

## Nginx Routing Configuration

Located at `config/nginx/conf.d/default.conf`:

| Path | Destination | Access | Notes |
|------|-------------|--------|-------|
| `/health` | Static 200 OK | Public | Health check endpoint |
| `/api/*` | `http://127.0.0.1:3000/` | Rate limited | Backend API (strip /api prefix) |
| `/neo4j/*` | `http://neo4j:7474/` | Internal only (172.16.0.0/12) | Neo4j browser |
| `/grafana/*` | `http://grafana:3000/` | Internal only | Monitoring dashboards |
| `/qdrant/*` | `http://qdrant:6333/` | Internal only | Qdrant REST API |
| `/openclaw/*` | `http://openclaw:18789/` | Internal only | Agent gateway (WebSocket) |
| `/*` | 404 JSON | - | Default fallback |

Rate limits: 10 requests/second with burst of 20, max 20 connections per IP.

## MCP HTTP Proxy API

Accessible at `https://epstein-api.allfrontoffice.com/mcp/` for Claude Code database access.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mcp/health` | Health check |
| GET | `/mcp/tools` | List available tools |
| POST | `/mcp/tools/query` | Execute SELECT query: `{"sql": "SELECT ..."}` |
| POST | `/mcp/tools/get_schema` | Get table schema: `{"table": "documents"}` |
| POST | `/mcp/tools/list_tables` | List all tables with sizes |
| POST | `/mcp/tools/get_stats` | Get document processing statistics |

**Example usage:**
```bash
# Get stats
curl -X POST https://epstein-api.allfrontoffice.com/mcp/tools/get_stats

# Run a query
curl -X POST https://epstein-api.allfrontoffice.com/mcp/tools/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT COUNT(*) FROM documents"}'

# Get table schema
curl -X POST https://epstein-api.allfrontoffice.com/mcp/tools/get_schema \
  -H "Content-Type: application/json" \
  -d '{"table": "documents"}'
```

## Cloudflare Worker API Endpoints

**Public Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with status, timestamp, environment |
| GET | `/documents/:key` | Retrieve document from R2 (cached 24h) |
| POST | `/search` | Vector similarity search (generates embedding, queries Qdrant) |
| GET | `/entities/:id` | Entity lookup with D1 caching (1h TTL) |
| POST | `/graph/traverse` | Graph traversal from start node |
| POST | `/graph/query` | Execute Cypher query on Neo4j |
| POST | `/faces/search` | Face similarity search |

**Internal Endpoints (require X-API-Key):**
| Method | Path | Description |
|--------|------|-------------|
| PUT | `/documents/:key` | Upload document to R2 |
| POST | `/ai/generate` | Text generation (Llama 3) |
| POST | `/ai/embedding` | Generate embedding (BGE-base) |
| POST | `/queue/documents` | Batch enqueue documents for processing |
| POST | `/queue/scan-unprocessed` | Scan and queue unprocessed docs |
| GET | `/queue/status` | Get processing queue status |
| POST | `/process/batch` | Direct batch processing (bypass queue) |
| POST | `/workflow/document` | Start document processing workflow |
| POST | `/workflow/batch` | Start batch processing workflow |
| GET | `/workflow/:id` | Get workflow status |
| GET | `/r2/list` | List R2 objects (for DB sync) |
| POST | `/r2/sync` | Sync R2 keys with database |

**Bindings (wrangler.toml):**
- `DOCUMENTS` - R2 Bucket: `epstein-documents`
- `CACHE_DB` - D1 Database: `epstein-cache`
- `SESSIONS` - KV Namespace for rate limiting
- `AI` - Workers AI with AI Gateway (`internal-gateway`)
- `DOCUMENT_QUEUE` - Queue for document processing
- `DLQ` - Dead letter queue for failed jobs
- `DOCUMENT_WORKFLOW` / `BATCH_WORKFLOW` - Workflow bindings

## Environment Variables

Required in `/opt/app/.env`:
```bash
# PostgreSQL
POSTGRES_USER=investigation
POSTGRES_PASSWORD=  # See /opt/app/.env on server
POSTGRES_DB=platform

# Qdrant
QDRANT_API_KEY=<generated>

# Neo4j
NEO4J_USER=neo4j
NEO4J_PASSWORD=<generated>

# API Keys
ANTHROPIC_API_KEY=<your-key>
OPENAI_API_KEY=<your-key>
GROQ_API_KEY=<your-key>

# Cloudflare
CLOUDFLARE_TUNNEL_TOKEN=<tunnel-token>

# OpenClaw Gateway
OPENCLAW_GATEWAY_TOKEN=<generated>

# Grafana
GRAFANA_PASSWORD=<generated>
```

## MCP Server Configuration

Config: `/opt/app/openclaw/config/mcp-servers.json`

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "POSTGRES_CONNECTION_STRING": "${DATABASE_URL}" }
    },
    "qdrant": {
      "command": "npx",
      "args": ["-y", "@qdrant/mcp-server"],
      "env": { "QDRANT_URL": "${QDRANT_URL}", "QDRANT_API_KEY": "${QDRANT_API_KEY}" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/node/.openclaw/workspace"]
    }
  }
}
```

All MCP servers use **stdio transport** (no HTTP ports). Custom MCP servers are copied into the container at `/opt/`.

## Data Flow Architecture

```
User Request
    ↓
Cloudflare CDN (edge caching)
    ↓
Cloudflare Worker (epstein-api)
    ├── R2 (document storage)
    ├── D1 (search/entity cache)
    ├── Workers AI (embeddings, LLM)
    └── Queue → DLQ
    ↓
Cloudflare Tunnel (cloudflared)
    ↓
Nginx (reverse proxy)
    ↓
Backend Services
    ├── epstein-api-backend (REST API, port 3000)
    ├── PostgreSQL (documents, metadata)
    ├── Qdrant (vector embeddings)
    └── Neo4j (entity graph)
    ↓
OpenClaw Agent (Claude Opus 4.5)
    └── MCP Servers (stdio)
```

## Continuous Document Processing

### Via Cloudflare Worker (single instance)

```bash
# Single batch (50 docs at a time)
curl -X POST https://epstein-api.carl-f-frank.workers.dev/process/batch \
  -H "X-API-Key: $API_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'

# Continuous processing loop
while true; do
  result=$(curl -s -X POST https://epstein-api.carl-f-frank.workers.dev/process/batch \
    -H "X-API-Key: $API_SECRET_KEY" \
    -H "Content-Type: application/json" \
    -d '{"limit": 50}')
  echo "$(date): $result" | jq -c '{processed, completed, failed}'
  sleep 2
done
```

### Parallel Processing on Dedicated Server

The backend containers use `FOR UPDATE SKIP LOCKED` for atomic document claiming, allowing true parallel processing.

**Start backend containers:**
```bash
ssh root@88.99.61.233
cd /opt/app
docker-compose up -d --build epstein-api-backend epstein-api-backend-2 epstein-api-backend-3 epstein-api-backend-4
docker-compose restart nginx
```

**Run parallel batch processing** (via tunnel):
```bash
# 4 parallel workers
for i in {1..4}; do
  while true; do
    curl -s -X POST https://epstein-api.allfrontoffice.com/api/documents/unprocessed?limit=25 \
      -H "X-API-Key: $API_SECRET_KEY" &
  done &
done
```

**Run from dedicated server** (direct, no tunnel latency):
```bash
# Use the batch processor script
cd /opt/app/scripts
chmod +x batch-processor.sh

# Run 4 parallel instances
./batch-processor.sh 1 25 &
./batch-processor.sh 2 25 &
./batch-processor.sh 3 25 &
./batch-processor.sh 4 25 &
```

**Check processing stats:**
```bash
curl -s -X POST https://epstein-api.allfrontoffice.com/mcp/tools/get_stats | jq .
```

### Processing Flow

1. Backend claims pending docs atomically (`FOR UPDATE SKIP LOCKED`)
2. Worker fetches PDF from R2
3. Backend extracts text via pdf-parse
4. If text extraction fails → marks as `needs_ocr` for GPU processing later
5. If successful → Worker generates embedding via Workers AI
6. Embedding stored in Qdrant, status updated to `completed`

### Document Statuses

- `pending` - Not yet processed
- `processing` - Currently being processed (claimed by a worker)
- `completed` - Text extracted and embedding generated
- `needs_ocr` - Image-based PDF, needs GPU OCR processing

## Notes

- PostgreSQL port 5432 is NOT exposed publicly (127.0.0.1 only)
- All external access goes through Cloudflare Tunnel → nginx
- OpenClaw uses Anthropic Claude Opus 4.5 as the agent model
- MCP servers run inside OpenClaw container using stdio transport
- `combined_all` dataset was deleted (redundant, all files existed in dataset_1-8)
- Duplicate detection uses `content_hash` column with unique constraint
- Docker network name: `app_app_network`
- Backend API key: `source /opt/app/.env && echo $API_SECRET_KEY` (for X-API-Key header)
- Worker AI uses BGE-base-en-v1.5 (768 dimensions) via AI Gateway
