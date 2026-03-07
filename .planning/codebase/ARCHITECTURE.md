# Architecture

**Analysis Date:** 2026-03-07

## Pattern Overview

**Overall:** Multi-tier distributed system with edge computing (Cloudflare Workers), a dedicated Hetzner server running Docker Compose services, and a SvelteKit frontend deployed to Cloudflare Pages.

**Key Characteristics:**
- Edge-first: Cloudflare Workers handle public API, caching, and AI inference at the edge
- Polyglot storage: PostgreSQL (documents/metadata), Qdrant (vector embeddings), Neo4j (entity graph), R2 (file storage)
- Horizontally scalable processing: Document processing pipelines use `FOR UPDATE SKIP LOCKED` for safe parallel execution across many container instances
- BFF pattern: Frontend server-side routes proxy through MCP HTTP Proxy to access backend databases
- Agent orchestration: OpenClaw (Claude Opus) with MCP servers for autonomous investigation

## Layers

**Edge Layer (Cloudflare):**
- Purpose: Public API gateway, caching, rate limiting, AI inference
- Location: `cloudflare-worker/src/index.ts`
- Contains: Hono API routes, R2 document storage, D1 search cache, Workers AI (LLM/embedding/OCR), Queue consumers
- Depends on: Cloudflare bindings (R2, D1, KV, AI, Queues), Origin server via `ORIGIN_URL`
- Used by: Public users, frontend, external consumers

**Frontend Layer (SvelteKit on Cloudflare Pages):**
- Purpose: User-facing investigation interface
- Location: `frontend/src/`
- Contains: SvelteKit routes, Svelte 5 components, server-side API routes (BFF)
- Depends on: MCP HTTP Proxy (via `API_BASE_URL` env var), OpenAI API (embeddings/chat)
- Used by: End users via browser

**Reverse Proxy Layer (Nginx):**
- Purpose: Internal traffic routing, rate limiting, access control
- Location: `config/nginx/conf.d/default.conf`
- Contains: Upstream definitions, location blocks for all internal services
- Depends on: All backend containers
- Used by: Cloudflare Tunnel (cloudflared), internal services

**MCP HTTP Proxy Layer (BFF for Frontend):**
- Purpose: Unified database access proxy with Redis caching. Proxies PostgreSQL queries, Qdrant searches, and Neo4j Cypher queries through a single authenticated HTTP API.
- Location: `mcp-http-proxy/index.js`
- Contains: Hono server with cached PostgreSQL queries, Qdrant passthrough proxy, Neo4j passthrough proxy, MCP-compatible tool endpoints
- Depends on: PostgreSQL, Redis, Qdrant, Neo4j
- Used by: Frontend server-side routes (`frontend/src/lib/server/`), Claude Code (external tooling)

**API Backend Layer (Document Processing):**
- Purpose: Text extraction from PDFs, embedding generation coordination
- Location: `cloudflare-worker/api-backend/fast-processor.js`
- Contains: Node.js service with pdf-parse, R2 client, Qdrant client, PostgreSQL pool
- Depends on: PostgreSQL, Qdrant, R2 (via S3 API), Cloudflare Worker (for embeddings)
- Used by: Nginx load balancer (4 instances: `epstein-api-backend` through `epstein-api-backend-4`)

**Processing Pipeline Layer (Batch Processing):**
- Purpose: Large-scale document processing (text extraction, embedding, entity extraction, classification, resolution)
- Location: `processing/` directory
- Contains: Python and Node.js processing scripts, each containerized independently
- Depends on: PostgreSQL, Qdrant, Neo4j, R2, OpenAI API, Cerebras API, Workers AI
- Used by: Docker Compose processing overlay (`docker-compose.processing.yml`)

**Agent Layer (OpenClaw + Investigation Agent):**
- Purpose: Autonomous AI-driven document investigation
- Location: `openclaw/` (agent orchestrator), `processing/investigation-agent/` (Python investigation agent)
- Contains: MCP server configs, investigation playbooks, LLM routing (Workers AI / Sonnet / Opus tiers)
- Depends on: PostgreSQL, Qdrant, Neo4j, Anthropic API, Workers AI
- Used by: Administrators via OpenClaw gateway

**Data Storage Layer:**
- Purpose: Persistent storage across four complementary systems
- Location: Defined in `docker-compose.yml`, schema in `config/postgres/init/01-schema.sql`
- Contains: PostgreSQL (documents, entities, audit), Qdrant (1536-dim embeddings), Neo4j (entity graph), Redis (query cache), R2 (PDF files)
- Depends on: Docker volumes under `data/`
- Used by: All other layers

## Data Flow

**Search Request (User to Results):**

1. User submits search query in frontend (`frontend/src/routes/(app)/search/+page.svelte`)
2. Frontend Svelte store calls SvelteKit API route (`frontend/src/routes/api/search/+server.ts`)
3. API route branches by search mode:
   - `fulltext`: SQL query with `plainto_tsquery` against `search_vector` tsvector column via MCP proxy
   - `semantic`: Generate 1536-dim embedding via OpenAI, search Qdrant via MCP proxy, hydrate from PostgreSQL
   - `hybrid`: Run both in parallel, combine via Reciprocal Rank Fusion (k=60)
4. Results returned with snippets, scores, entity references

**Chat (RAG Pipeline):**

1. User sends message (`frontend/src/routes/api/chat/+server.ts`)
2. Server generates embedding of user query via OpenAI `text-embedding-3-small`
3. Qdrant search returns top 8 relevant document chunks
4. PostgreSQL hydrates document metadata
5. System prompt built with document context and citation markers
6. OpenAI `gpt-4o-mini` streams response via SSE with citations sent as first event

**Document Processing Pipeline:**

1. PDFs stored in R2 (Cloudflare) or Hetzner Object Storage
2. Text extractors (up to 24 parallel containers) claim documents via `FOR UPDATE SKIP LOCKED`
3. Text extracted via `pdftotext`/`pdf-parse`, stored in PostgreSQL `metadata->>'text'`
4. Embedding generators create 1536-dim vectors via OpenAI, store in Qdrant `document_embeddings_v2`
5. Entity extractors use Cerebras LLaMA 3.1 to identify People/Orgs/Locations, store in Neo4j
6. Entity resolution deduplicates Neo4j nodes via Jaro-Winkler similarity
7. Document classifier categorizes docs (email, court_filing, deposition, etc.) via Workers AI

**State Management (Frontend):**
- Svelte 5 runes (`$state`, `$derived`) for reactive stores
- Feature-scoped stores: `searchStore` (`frontend/src/lib/features/search/stores.svelte.ts`), graph store (`frontend/src/lib/features/graph/stores.svelte.ts`), chat store (`frontend/src/lib/features/chat/stores.svelte.ts`)
- URL state synchronization for search page (query, mode, page params)
- No global state management library; state is co-located with features

## Key Abstractions

**Server Database Clients (Frontend BFF):**
- Purpose: Thin wrappers that proxy database calls through MCP HTTP Proxy
- Examples: `frontend/src/lib/server/db.ts`, `frontend/src/lib/server/neo4j.ts`, `frontend/src/lib/server/qdrant.ts`
- Pattern: Factory functions accepting `App.Platform`, returning typed query methods. All calls go through `API_BASE_URL/mcp/*` with `X-API-Key` auth.

**Processing Workers (Pipeline):**
- Purpose: Parallel document processing with atomic work claiming
- Examples: `processing/text-extractor/`, `processing/embedding-generator/`, `processing/entity-extractor/`
- Pattern: Each worker claims a batch via `FOR UPDATE SKIP LOCKED`, processes independently, updates status. Scaled by duplicating containers with different `WORKER_ID`.

**MCP Servers (Agent Tools):**
- Purpose: Give AI agents structured access to databases
- Examples: `cloudflare-worker/mcp-servers/epstein-documents/index.js`, `cloudflare-worker/mcp-servers/epstein-intelligence/index.js`
- Pattern: MCP protocol over stdio, loaded by OpenClaw container. Config at `openclaw/config/mcp-servers.json`.

**Investigation Playbooks:**
- Purpose: Structured investigation patterns for the investigation agent
- Examples: `processing/investigation-agent/playbooks/person_profile.py`, `processing/investigation-agent/playbooks/connection_map.py`, `processing/investigation-agent/playbooks/timeline.py`
- Pattern: Inherit from base playbook, define steps that query databases and route to appropriate LLM tier

## Entry Points

**Cloudflare Worker (Edge API):**
- Location: `cloudflare-worker/src/index.ts`
- Triggers: HTTP requests to `https://epstein-api.carl-f-frank.workers.dev/*`
- Responsibilities: Public document retrieval, search, entity lookup, graph queries, AI inference, document processing orchestration

**Frontend (SvelteKit):**
- Location: `frontend/src/routes/`
- Triggers: Browser navigation, deployed to Cloudflare Pages
- Responsibilities: UI rendering, BFF API routes for search/chat/graph/entities

**MCP HTTP Proxy:**
- Location: `mcp-http-proxy/index.js`
- Triggers: HTTP requests on port 3002 (internal via nginx `/mcp/`)
- Responsibilities: Authenticated database access for frontend and Claude Code

**API Backend (Document Processing):**
- Location: `cloudflare-worker/api-backend/fast-processor.js`
- Triggers: HTTP requests on port 3000 (internal via nginx `/api/`)
- Responsibilities: PDF text extraction, embedding coordination, load balanced across 4 instances

**Docker Compose (Infrastructure):**
- Location: `docker-compose.yml` (core services), `docker-compose.processing.yml` (processing pipeline)
- Triggers: `docker compose up -d` on the Hetzner server
- Responsibilities: Service orchestration, health checks, resource limits

**Investigation Agent (Interactive):**
- Location: `processing/investigation-agent/agent.py`
- Triggers: Interactive terminal session via `docker compose run -it investigation-agent`
- Responsibilities: Autonomous document investigation using playbooks and tiered LLM routing

## Error Handling

**Strategy:** Mostly try/catch with JSON error responses. No centralized error framework.

**Patterns:**
- Cloudflare Worker: Each route wrapped in try/catch, returns `{ error: string }` with appropriate HTTP status
- Frontend API routes: try/catch with `json({ error: String(error) }, { status: 500 })`
- MCP HTTP Proxy: try/catch per tool, returns error message in JSON
- Processing pipelines: Per-document error handling with status updates (`failed`, `needs_ocr`). Failures do not halt the batch.
- Hono `onError` global handler in Worker as fallback

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` throughout. Processing pipelines use Python `logging` module. No structured logging framework.

**Validation:** Inline validation in route handlers. No schema validation library (no Zod, no Joi). Input checks are ad-hoc (`if (!query)` style).

**Authentication:**
- Edge: `X-API-Key` header checked against `API_SECRET_KEY` env var for internal endpoints
- Frontend: Cloudflare Access JWT via `Cf-Access-Authenticated-User-Email` header (parsed in `frontend/src/hooks.server.ts`)
- Nginx: IP-based access control for internal services (`allow 172.16.0.0/12; deny all`)
- MCP Proxy: `X-API-Key` middleware (`requireAuth`)
- No user-level auth system yet (users table exists in schema but unused)

**Caching:**
- Redis: Query result caching in MCP Proxy with TTL-based expiry (2 min to 1 hour based on query type)
- D1: Search result cache (10 min) and entity cache (1 hour) in Cloudflare Worker
- Nginx: Not configured for caching
- R2: Document retrieval cached 24 hours via `Cache-Control` headers

---

*Architecture analysis: 2026-03-07*
