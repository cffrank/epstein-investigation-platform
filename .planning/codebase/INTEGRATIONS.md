# External Integrations

**Analysis Date:** 2026-03-07

## APIs & External Services

**AI / LLM:**
- Anthropic Claude - Agent orchestration (OpenClaw via Opus 4.5), investigation agent reasoning (Sonnet/Opus)
  - SDK/Client: `anthropic` Python SDK (>=0.42.0) in `processing/investigation-agent/requirements.txt`
  - Also: OpenClaw uses Anthropic API directly via `ANTHROPIC_API_KEY`
  - Auth: `ANTHROPIC_API_KEY` env var

- OpenAI - Embedding generation (text-embedding-3-small, 1536 dimensions)
  - SDK/Client: HTTP API via `requests` library in `processing/embedding-generator/embed.py`
  - Auth: `OPENAI_API_KEY` env var (set via `wrangler secret put` for Worker, env var for processing)

- Cloudflare Workers AI - Document classification, edge embeddings (BGE-base-en-v1.5, 768 dim), text generation (Llama models)
  - SDK/Client: `AI` binding in Worker (`cloudflare-worker/wrangler.toml`), HTTP API from processing containers
  - Gateway: `internal-gateway` AI Gateway (`cloudflare-worker/wrangler.toml`)
  - Auth: `AI_GATEWAY_TOKEN` for gateway, `API_SECRET_KEY` for Worker endpoints
  - Models: `@cf/meta/llama-4-scout-17b-16e-instruct` (investigation agent), `@cf/baai/bge-base-en-v1.5` (edge embeddings)

- Cerebras - Fast entity extraction (Llama 3.1 8B)
  - SDK/Client: HTTP API via `requests` in `processing/entity-extractor/extract.py`
  - Auth: `CEREBRAS_API_KEY` env var
  - Model: `llama3.1-8b`

- Groq - Available as fallback LLM
  - Auth: `GROQ_API_KEY` env var (configured in OpenClaw container)

**MCP (Model Context Protocol):**
- `@modelcontextprotocol/server-postgres` - PostgreSQL access for OpenClaw agent (`openclaw/config/mcp-servers.json`)
- `mcp-server-qdrant` 0.8.1 (Python) - Qdrant access for OpenClaw agent (`openclaw/Dockerfile`)
- `mcp-neo4j-cypher` 0.5.2 (Python) - Neo4j access for OpenClaw agent (`openclaw/Dockerfile`)
- `@modelcontextprotocol/server-filesystem` - Filesystem access for OpenClaw agent
- Custom `epstein-documents` MCP server - Document search tools (`cloudflare-worker/mcp-servers/epstein-documents/`)
- Custom `epstein-intelligence` MCP server - Investigation tools (`cloudflare-worker/mcp-servers/epstein-intelligence/`)
- MCP HTTP Proxy - HTTP bridge for Claude Code database access (`mcp-http-proxy/index.js`)

## Data Storage

**Databases:**
- PostgreSQL 16 (Alpine) - Primary document store (961K+ documents)
  - Connection: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` env vars
  - Client (Node.js): `pg` ^8.11.0+
  - Client (Python): `psycopg2-binary` 2.9.9
  - Tables: `documents`, `investigation_notes`, `source_credibility`, `allegation_tags`
  - Features: Full-text search (`search_vector` tsvector), MD5 dedup (`content_hash`), `import_document()` function
  - Memory: 20GB limit, 4GB shared memory

- Qdrant v1.16.2 - Vector similarity search
  - Connection: `QDRANT_API_KEY`, host `qdrant:6333`
  - Client (Node.js): `@qdrant/js-client-rest` ~1.9.0
  - Client (Python): `qdrant-client` 1.7.x
  - Collections: `document_embeddings` (768 dim, legacy BGE), `document_embeddings_v2` (1536 dim, OpenAI)
  - Memory: 24GB limit

- Neo4j 5 Community - Knowledge graph (entity relationships)
  - Connection: `NEO4J_USER`, `NEO4J_PASSWORD`, bolt://neo4j:7687
  - Client (Node.js): `neo4j-driver` ^5.17.0
  - Client (Python): `neo4j` 5.17.0-5.25.0
  - Plugins: APOC
  - Node types: Person, Organization, Location, Event
  - Memory: 14GB limit (4GB heap init, 8GB heap max, 4GB page cache)

- Cloudflare D1 - Edge cache database
  - Binding: `CACHE_DB` in `cloudflare-worker/wrangler.toml`
  - Database: `epstein-cache` (ID: `ea7bdcb5-d8f4-4d6c-8ac4-e9dc3c3075c4`)
  - Purpose: Entity lookup caching (1h TTL), search result caching

**Caching:**
- Redis 7 (Alpine) - Session caching and job queue
  - Connection: `redis://redis:6379/0`
  - Client: `redis` ^4.7.0 (Node.js)
  - Config: appendonly, 2GB max, allkeys-lru eviction
  - Used by: MCP HTTP Proxy (`mcp-http-proxy/index.js`)

- Cloudflare KV - Rate limiting / session storage
  - Binding: `SESSIONS` in `cloudflare-worker/wrangler.toml`
  - Namespace ID: `eea15de47a4e454ca1079e6a218d26fe`

**File/Object Storage:**
- Cloudflare R2 - Primary document storage (PDFs)
  - Binding: `DOCUMENTS` in `cloudflare-worker/wrangler.toml`
  - Bucket: `epstein-documents`
  - Client (Node.js): `@aws-sdk/client-s3` ^3.500.0 (S3-compatible API)
  - Client (Python): `boto3` 1.34.0 (S3-compatible API)
  - Auth: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

- Hetzner Object Storage - Secondary/backup document storage (S3-compatible)
  - Client (Python): `boto3` 1.34.0
  - Auth: `HETZNER_S3_ENDPOINT`, `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY`
  - Bucket: `HETZNER_S3_BUCKET` (default: `epstein-documents`)
  - Used by: text-extractor (dual-fetch from R2 and Hetzner), investigation-agent (report storage)

## Authentication & Identity

**Auth Provider:**
- API Key authentication (custom)
  - Implementation: `API_SECRET_KEY` checked via `X-API-Key` header
  - MCP HTTP Proxy: Fails closed if `API_SECRET_KEY` not set (`mcp-http-proxy/index.js` line 20-23)
  - Worker internal endpoints: `X-API-Key` header required

- Cloudflare Access (Zero Trust) - External access control
  - Implementation: Cloudflare Tunnel routes through Zero Trust policies
  - Tunnel endpoint: `https://epstein-api.allfrontoffice.com`

- OpenClaw Gateway Token - Agent access
  - Auth: `OPENCLAW_GATEWAY_TOKEN` env var

- No end-user authentication system (no Clerk, no OAuth) - platform is operator-only

## Monitoring & Observability

**Metrics:**
- Prometheus (latest) - Metrics collection
  - Config: `config/prometheus/prometheus.yml`
  - Alert rules: `config/prometheus/alert_rules.yml`
  - Retention: 30 days
  - Port: 9090 (localhost only)

- Node Exporter (latest) - Host-level system metrics
  - Port: 9100 (localhost only)

**Dashboards:**
- Grafana (latest) - Visualization and alerting
  - Port: 3001 (localhost only, mapped from container 3000)
  - Auth: `GRAFANA_PASSWORD` env var, sign-up disabled

**Error Tracking:**
- None (no Sentry, no Datadog)

**Logs:**
- Docker container logs (stdout/stderr)
- Nginx access/error logs at `logs/nginx/`
- Neo4j logs at `logs/neo4j/`
- No centralized log aggregation

## CI/CD & Deployment

**Hosting:**
- Hetzner AX42 dedicated server (Falkenstein, Germany) - All Docker services
- Cloudflare Workers - Edge API (`cloudflare-worker/`)
- Cloudflare Pages - Frontend (via `@sveltejs/adapter-cloudflare`)

**CI Pipeline:**
- None detected (no GitHub Actions, no CI config files)

**Deployment:**
- Server: `ssh root@88.99.61.233`, then `cd /opt/app && git pull && docker compose up -d --build`
- Worker: `cd cloudflare-worker && npx wrangler deploy`
- Frontend: Deployed via Cloudflare Pages (adapter handles build)
- Processing: `docker-compose -f docker-compose.yml -f docker-compose.processing.yml up -d`

**Backup:**
- Script: `scripts/04-backup.sh`
- Cron setup: `scripts/backup-cron-setup.sh`
- Backup dirs: `backups/postgres/`, `backups/qdrant/`, `backups/neo4j/`

## Cloudflare Worker Bindings

**Queues:**
- `DOCUMENT_QUEUE` - Document processing queue (`epstein-document-processing`)
  - Batch size: 10, timeout: 30s, retries: 3
  - Dead letter: `epstein-processing-dlq`
- `DLQ` - Dead letter queue (`epstein-processing-dlq`)
  - Batch size: 1, retries: 0

**Workflows:**
- `DOCUMENT_WORKFLOW` - Single document processing (`DocumentProcessingWorkflow`)
- `BATCH_WORKFLOW` - Batch document processing (`BatchProcessingWorkflow`)

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- None detected

## Environment Configuration

**Required env vars (server `.env`):**
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `QDRANT_API_KEY`
- `NEO4J_USER`, `NEO4J_PASSWORD`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`
- `CLOUDFLARE_TUNNEL_TOKEN`
- `OPENCLAW_GATEWAY_TOKEN`
- `GRAFANA_PASSWORD`
- `API_SECRET_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `HETZNER_S3_ENDPOINT`, `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY`

**Required Worker secrets (via `wrangler secret put`):**
- `API_SECRET_KEY`
- `OPENAI_API_KEY`
- `AI_GATEWAY_TOKEN`

**Secrets location:**
- Server: `/opt/app/.env`
- Worker: Cloudflare dashboard / `wrangler secret`
- Local dev: ProtonPass vault `AxiomAI` (see global CLAUDE.md)

---

*Integration audit: 2026-03-07*
