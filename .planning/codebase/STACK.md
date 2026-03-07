# Technology Stack

**Analysis Date:** 2026-03-07

## Languages

**Primary:**
- TypeScript 5.9.3 - Cloudflare Worker (`cloudflare-worker/src/`), Frontend (`frontend/src/`), MCP HTTP Proxy (`mcp-http-proxy/`)
- JavaScript (ES Modules) - API Backend (`cloudflare-worker/api-backend/index.js`), MCP Servers (`cloudflare-worker/mcp-servers/`), Entity Extractor (`processing/entity-extractor/extract.js`)
- Python 3.11 - Processing pipeline containers (`processing/text-extractor/`, `processing/embedding-generator/`, `processing/entity-extractor/`, `processing/r2-uploader/`, `processing/entity-resolution/`, `processing/document-classifier/`, `processing/investigation-agent/`)

**Secondary:**
- Bash - Setup and maintenance scripts (`scripts/`)
- Cypher - Neo4j graph queries (used within Python/JS services)
- SQL - PostgreSQL queries (used within all backend services)

## Runtime

**Environment:**
- Node.js 22 (Bookworm) - OpenClaw agent container (`openclaw/Dockerfile`)
- Node.js 20 (Alpine) - API backend containers (`cloudflare-worker/api-backend/Dockerfile`)
- Python 3.11 (Slim) - Processing pipeline containers (`processing/text-extractor/Dockerfile`)
- Cloudflare Workers - Edge runtime for `cloudflare-worker/src/index.ts`

**Package Manager:**
- npm - Used across all Node.js packages (no lockfile committed for most)
- pnpm - OpenClaw agent build (`openclaw/Dockerfile` runs `pnpm install`)
- pip - Python processing containers (pinned versions in `requirements.txt`)
- No monorepo manager (each directory is an independent package)

## Frameworks

**Core:**
- Hono ^4.0.0 - HTTP framework for Cloudflare Worker (`cloudflare-worker/package.json`), API Backend (`cloudflare-worker/api-backend/package.json`), MCP HTTP Proxy (`mcp-http-proxy/package.json`)
- SvelteKit ^2.50.2 - Frontend framework (`frontend/package.json`)
- Svelte ^5.49.2 - Component framework (`frontend/package.json`)

**UI:**
- Tailwind CSS ^4.1.18 - Styling via Vite plugin (`frontend/package.json`)
- bits-ui ^2.15.5 - Headless Svelte components (`frontend/package.json`)
- tailwind-variants ^3.2.2 - Variant-based styling (`frontend/package.json`)
- tailwind-merge ^3.4.1 - Class merging utility (`frontend/package.json`)
- Lucide Svelte ^0.564.0 - Icons (`frontend/package.json`)
- cytoscape ^3.33.1 - Graph visualization (`frontend/package.json`)
- cmdk-sv ^0.0.19 - Command palette (`frontend/package.json`)
- svelte-sonner ^1.0.7 - Toast notifications (`frontend/package.json`)
- mode-watcher ^1.1.0 - Dark mode (`frontend/package.json`)
- paneforge ^1.0.2 - Resizable panels (`frontend/package.json`)
- formsnap ^2.0.1 - Form handling (`frontend/package.json`)

**Build/Dev:**
- Vite ^7.3.1 - Frontend build tool (`frontend/package.json`)
- Wrangler ^4.62.0 - Cloudflare Worker CLI (`cloudflare-worker/package.json`)
- svelte-check ^4.3.6 - Svelte type checking (`frontend/package.json`)

**Testing:**
- Not detected - No test framework configured in any `package.json`

## Key Dependencies

**Critical (Backend/Worker):**
- `hono` ^4.0.0 - HTTP routing for all backend services (`cloudflare-worker/package.json`, `cloudflare-worker/api-backend/package.json`, `mcp-http-proxy/package.json`)
- `pg` ^8.11.0+ - PostgreSQL client for Node.js (`cloudflare-worker/api-backend/package.json`, `mcp-http-proxy/package.json`, MCP servers)
- `neo4j-driver` ^5.17.0 - Neo4j Bolt driver (`cloudflare-worker/api-backend/package.json`, `processing/entity-extractor/package.json`)
- `@qdrant/js-client-rest` ~1.9.0 - Qdrant vector DB client (`cloudflare-worker/api-backend/package.json`)
- `@aws-sdk/client-s3` ^3.500.0 - S3-compatible storage access for R2 and Hetzner (`cloudflare-worker/api-backend/package.json`)
- `pdf-parse` ^1.1.1 - PDF text extraction in Node.js (`cloudflare-worker/api-backend/package.json`)
- `@modelcontextprotocol/sdk` ^1.25.3 - MCP server SDK (`cloudflare-worker/mcp-servers/package.json`)
- `redis` ^4.7.0 - Redis client (`mcp-http-proxy/package.json`)
- `compromise` ^14.10.0 - NLP entity extraction (`cloudflare-worker/entity-extraction/package.json`)

**Critical (Python Processing):**
- `psycopg2-binary` 2.9.9 - PostgreSQL client for Python (all processing containers)
- `neo4j` 5.17.0-5.25.0 - Neo4j driver for Python (`processing/entity-extractor/`, `processing/entity-resolution/`, `processing/investigation-agent/`)
- `qdrant-client` 1.7.0-1.7.3 - Qdrant client (`processing/embedding-generator/`, `processing/investigation-agent/`)
- `boto3` 1.34.0 - AWS S3 SDK for R2/Hetzner storage (`processing/r2-uploader/`, `processing/text-extractor/`, `processing/investigation-agent/`)
- `anthropic` >=0.42.0 - Anthropic Claude SDK (`processing/investigation-agent/requirements.txt`)
- `jellyfish` 1.1.0 - String similarity (Jaro-Winkler) for entity dedup (`processing/entity-resolution/requirements.txt`)
- `requests` 2.31.0-2.32.3 - HTTP client (most processing containers)

**Infrastructure:**
- `@cloudflare/workers-types` ^4.20260203.0 - Cloudflare Worker types (`cloudflare-worker/package.json`)
- `@hono/node-server` ^1.8.0 - Hono Node.js adapter (`cloudflare-worker/api-backend/package.json`, `mcp-http-proxy/package.json`)
- `@sveltejs/adapter-cloudflare` ^7.2.7 - Cloudflare Pages adapter (`frontend/package.json`)

## Configuration

**Environment:**
- `.env` file on server at `/opt/app/.env` (never committed)
- Docker Compose interpolates env vars from `.env` into containers
- Cloudflare Worker secrets set via `wrangler secret put`
- Required env vars: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `QDRANT_API_KEY`, `NEO4J_USER`, `NEO4J_PASSWORD`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`, `OPENCLAW_GATEWAY_TOKEN`, `GRAFANA_PASSWORD`, `API_SECRET_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CEREBRAS_API_KEY`, `HETZNER_S3_ENDPOINT`, `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY`

**Build:**
- `cloudflare-worker/tsconfig.json` - TypeScript config (ES2022, bundler module resolution, strict)
- `cloudflare-worker/wrangler.toml` - Worker bindings (R2, D1, KV, AI, Queues, Workflows)
- `frontend/tsconfig.json` - SvelteKit TypeScript config (extends `.svelte-kit/tsconfig.json`, strict, bundler resolution)
- `config/nginx/conf.d/default.conf` - Nginx reverse proxy routing
- `config/postgres/postgresql.conf` - PostgreSQL tuning
- `config/prometheus/prometheus.yml` - Metrics collection config
- `config/prometheus/alert_rules.yml` - Alerting rules

**Docker:**
- `docker-compose.yml` - Core services (16 containers: openclaw, postgres, qdrant, neo4j, redis, nginx, cloudflared, 4x api-backend, mcp-http-proxy, prometheus, grafana, node-exporter)
- `docker-compose.processing.yml` - Processing pipeline (overlay compose, 24x text-extractor, 2x r2-uploader, 2x embedding-generator, 2x entity-extractor, entity-resolution, document-classifier, investigation-agent)

## Platform Requirements

**Development:**
- Node.js 20+ (for API backend development)
- Python 3.11 (for processing pipeline development)
- Docker and Docker Compose (for running full stack)
- Wrangler CLI (for Cloudflare Worker deployment)
- SSH access to Hetzner server (`ssh root@88.99.61.233`)

**Production:**
- Hetzner AX42 dedicated server (Falkenstein, Germany)
- Docker Compose orchestration (no Kubernetes)
- Cloudflare Tunnel for ingress (Zero Trust)
- Cloudflare Workers for edge compute
- Cloudflare Pages for frontend hosting (via `@sveltejs/adapter-cloudflare`)
- Total memory allocation: ~64GB+ across all containers

---

*Stack analysis: 2026-03-07*
