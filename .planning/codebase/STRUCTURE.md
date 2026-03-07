# Codebase Structure

**Analysis Date:** 2026-03-07

## Directory Layout

```
epstein-investigation-platform/
├── agents/                          # Agent prompt templates (markdown)
├── cloudflare-worker/               # Cloudflare Worker (Edge API)
│   ├── src/                         # Worker TypeScript source
│   │   ├── index.ts                 # Main Hono API (1096 lines)
│   │   ├── workflow.ts              # Workflow definitions
│   │   └── r2-sync.ts              # R2 object listing utility
│   ├── api-backend/                 # Node.js backend for text extraction
│   │   ├── fast-processor.js        # Parallel document processor
│   │   └── sync-missing-files.js    # R2 sync utility
│   ├── mcp-servers/                 # MCP servers (copied into OpenClaw container)
│   │   ├── epstein-documents/       # Document search MCP server
│   │   ├── epstein-intelligence/    # Investigation intelligence MCP server
│   │   └── epstein-research-mcp/    # Research MCP server
│   ├── entity-extraction/           # Entity extraction scripts (JS)
│   ├── scripts/                     # Worker-related scripts
│   ├── package.json                 # Hono + wrangler
│   └── tsconfig.json
├── config/                          # Infrastructure configuration
│   ├── nginx/                       # Nginx reverse proxy
│   │   ├── nginx.conf               # Main nginx config
│   │   └── conf.d/default.conf      # Server blocks, upstreams
│   ├── postgres/                    # PostgreSQL configuration
│   │   ├── postgresql.conf          # Tuned for 20GB memory
│   │   └── init/01-schema.sql       # Database schema (DDL)
│   ├── prometheus/                  # Prometheus monitoring
│   │   ├── prometheus.yml           # Scrape targets
│   │   └── alert_rules.yml          # Alert definitions
│   └── grafana/                     # Grafana dashboards
│       └── provisioning/alerting/
├── frontend/                        # SvelteKit application (Cloudflare Pages)
│   ├── src/
│   │   ├── app.css                  # Global Tailwind styles
│   │   ├── app.d.ts                 # App type declarations
│   │   ├── hooks.server.ts          # Server hooks (auth)
│   │   ├── lib/                     # Shared library code
│   │   │   ├── assets/              # Static assets
│   │   │   ├── components/          # Shared UI components
│   │   │   │   ├── layout/          # App shell (Sidebar, CommandSearch)
│   │   │   │   └── ui/              # shadcn-svelte primitives
│   │   │   ├── features/            # Feature modules
│   │   │   │   ├── chat/            # RAG chat interface
│   │   │   │   │   ├── components/  # ChatInput, ChatMessage, CitationPanel
│   │   │   │   │   ├── stores.svelte.ts
│   │   │   │   │   └── sse.ts       # SSE streaming client
│   │   │   │   ├── document-viewer/ # Document detail view
│   │   │   │   │   └── components/  # EntityList, TextView
│   │   │   │   ├── entities/        # Entity browser
│   │   │   │   │   └── components/  # EntityHoverCard
│   │   │   │   ├── filters/         # Search filter sidebar
│   │   │   │   │   └── components/  # FilterSidebar
│   │   │   │   ├── graph/           # Knowledge graph visualizer
│   │   │   │   │   ├── components/  # GraphCanvas, GraphControls, GraphSearch
│   │   │   │   │   ├── stores.svelte.ts
│   │   │   │   │   └── index.ts     # Barrel export
│   │   │   │   └── search/          # Search interface
│   │   │   │       ├── components/  # SearchResults, Pagination
│   │   │   │       └── stores.svelte.ts
│   │   │   ├── server/              # Server-only database clients
│   │   │   │   ├── db.ts            # PostgreSQL proxy client
│   │   │   │   ├── neo4j.ts         # Neo4j proxy client
│   │   │   │   └── qdrant.ts        # Qdrant proxy client
│   │   │   ├── types/index.ts       # Shared TypeScript interfaces
│   │   │   └── utils/index.ts       # Utility functions (cn, truncate, etc.)
│   │   └── routes/                  # SvelteKit file-based routing
│   │       ├── +layout.svelte       # Root layout (Toaster)
│   │       ├── +page.svelte         # Homepage / dashboard
│   │       ├── +page.server.ts      # Homepage data loader
│   │       ├── +error.svelte        # Error page
│   │       ├── (app)/               # App layout group (sidebar shell)
│   │       │   ├── +layout.svelte   # Sidebar + main content layout
│   │       │   ├── chat/+page.svelte
│   │       │   ├── documents/[id]/  # Document detail
│   │       │   ├── entities/        # Entity list + detail
│   │       │   ├── graph/           # Knowledge graph
│   │       │   └── search/          # Search page
│   │       └── api/                 # Server-side API routes (BFF)
│   │           ├── chat/+server.ts  # RAG chat endpoint (SSE)
│   │           ├── documents/[id]/  # Document API
│   │           ├── entities/        # Entity API
│   │           ├── graph/+server.ts # Graph traversal API
│   │           └── search/+server.ts # Multi-mode search API
│   ├── static/                      # Static files
│   ├── components.json              # shadcn-svelte config
│   └── package.json
├── mcp-http-proxy/                  # Database access proxy (Docker container)
│   ├── index.js                     # Hono server (302 lines)
│   └── package.json
├── openclaw/                        # OpenClaw agent orchestrator
│   ├── Dockerfile
│   └── config/mcp-servers.json      # MCP server configuration
├── processing/                      # Document processing pipelines
│   ├── text-extractor/              # PDF text extraction (Python)
│   │   └── extract.py
│   ├── embedding-generator/         # OpenAI embedding generation (Python)
│   │   └── embed.py
│   ├── entity-extractor/            # Entity NER extraction (JS + Python)
│   │   ├── extract.js
│   │   └── extract.py
│   ├── entity-resolution/           # Entity deduplication (Python)
│   │   ├── resolve.py
│   │   └── sync_to_postgres.py
│   ├── document-classifier/         # Document classification (Python)
│   │   └── classify.py
│   ├── investigation-agent/         # Autonomous investigation agent (Python)
│   │   ├── agent.py                 # Main CLI entry point
│   │   ├── config.py                # Configuration
│   │   ├── db/                      # Database clients
│   │   │   ├── postgres.py
│   │   │   ├── qdrant_client.py
│   │   │   ├── neo4j_client.py
│   │   │   └── unified.py          # Unified search across all DBs
│   │   ├── engine/                  # Investigation engine
│   │   │   ├── executor.py
│   │   │   ├── findings.py
│   │   │   ├── reports.py
│   │   │   └── state.py
│   │   ├── llm/                     # LLM routing and prompts
│   │   │   ├── router.py            # Tiered LLM routing
│   │   │   ├── claude.py
│   │   │   ├── workers_ai.py
│   │   │   └── prompts.py
│   │   └── playbooks/               # Investigation playbooks
│   │       ├── base.py
│   │       ├── person_profile.py
│   │       ├── connection_map.py
│   │       ├── timeline.py
│   │       ├── document_triage.py
│   │       ├── anomaly_detection.py
│   │       └── free_form.py
│   ├── r2-uploader/                 # R2 upload utility (Python)
│   │   └── upload.py
│   ├── vlm-batch/                   # Vision-language model batch processing
│   │   ├── cloudflare_ocr.py
│   │   └── qdrant/                  # VLM embedding utilities
│   ├── extract_court_records.py     # One-off court record extraction
│   ├── ingest_court_records.py      # Court record ingestion
│   ├── ocr_openai.py               # OpenAI-based OCR
│   ├── ocr_fast.py                  # Fast OCR pipeline
│   ├── ocr_gdrive_images.py        # Google Drive image OCR
│   ├── process_all_downloads.py    # Bulk download processing
│   └── process_gdrive_local.py     # Google Drive local processing
├── scripts/                         # Infrastructure scripts
│   ├── 01-base-setup.sh             # Server base setup
│   ├── 02-generate-secrets.sh       # Secret generation
│   ├── 03-cloudflare-setup.sh       # Cloudflare tunnel setup
│   ├── 04-backup.sh                 # Database backup
│   ├── 05-health-check.sh           # Service health checks
│   ├── batch-processor.sh           # Batch processing runner
│   ├── batch_processor.sh           # Alternate batch processor
│   ├── run_pipeline.sh              # Full pipeline runner
│   ├── check-processing-status.sh   # Processing status checker
│   ├── restart-entity-extraction.sh # Entity extraction restart
│   ├── retry-embeddings.sh          # Embedding retry script
│   ├── backup-cron-setup.sh         # Cron backup setup
│   ├── generate_embeddings.py       # Standalone embedding script
│   ├── upload_safe.py               # Safe upload utility
│   ├── verify_r2_sync.py            # R2 sync verification
│   └── hetzner-object-storage/      # Hetzner S3 utilities
│       ├── upload_to_hetzner.py
│       ├── fetch_from_hetzner.py
│       └── download_ds*.sh          # Dataset download scripts
├── docs/                            # Documentation
│   ├── plans/                       # Implementation plans
│   └── CODE-REVIEW-2026-03-07.md    # Code review findings
├── .github/workflows/
│   └── deploy-frontend.yml          # CI: lint, build, deploy frontend
├── docker-compose.yml               # Core services (12 containers)
├── docker-compose.processing.yml    # Processing pipeline (30+ containers)
├── CLAUDE.md                        # System documentation
├── PRD.md                           # Product requirements
└── ROADMAP.md                       # Implementation roadmap
```

## Directory Purposes

**`cloudflare-worker/`:**
- Purpose: Edge API and supporting services that run on/interact with Cloudflare
- Contains: Hono TypeScript Worker, Node.js API backend, MCP server source code
- Key files: `src/index.ts` (main Worker), `api-backend/fast-processor.js` (document processor)

**`frontend/`:**
- Purpose: SvelteKit web application deployed to Cloudflare Pages
- Contains: Svelte 5 components, server-side API routes, database proxy clients, TypeScript types
- Key files: `src/routes/api/search/+server.ts`, `src/lib/server/db.ts`, `src/lib/types/index.ts`

**`mcp-http-proxy/`:**
- Purpose: Internal HTTP proxy that provides authenticated access to PostgreSQL, Qdrant, and Neo4j
- Contains: Single Hono server with Redis caching
- Key files: `index.js` (entire service)

**`processing/`:**
- Purpose: Batch document processing pipelines, each containerized independently
- Contains: Python and Node.js scripts for text extraction, embedding generation, entity extraction, classification, investigation
- Key files: `investigation-agent/agent.py`, `text-extractor/extract.py`, `embedding-generator/embed.py`

**`config/`:**
- Purpose: Infrastructure configuration files mounted into Docker containers
- Contains: Nginx routing, PostgreSQL tuning, Prometheus metrics, Grafana alerting
- Key files: `nginx/conf.d/default.conf` (routing rules), `postgres/init/01-schema.sql` (database schema)

**`scripts/`:**
- Purpose: Server setup, maintenance, and operational scripts
- Contains: Bash and Python scripts for backup, health checks, data processing
- Key files: `04-backup.sh`, `05-health-check.sh`, `batch-processor.sh`

**`openclaw/`:**
- Purpose: Configuration for the OpenClaw AI agent orchestrator container
- Contains: Dockerfile and MCP server configuration
- Key files: `config/mcp-servers.json`

**`agents/`:**
- Purpose: Prompt templates for various AI agent roles
- Contains: Markdown files defining agent behaviors
- Key files: `investigation-agent.md`, `coordinator.md`, `ocr-agent.md`

## Key File Locations

**Entry Points:**
- `cloudflare-worker/src/index.ts`: Edge API (Cloudflare Worker)
- `frontend/src/routes/+page.svelte`: Frontend homepage
- `frontend/src/hooks.server.ts`: Server request hooks (auth)
- `mcp-http-proxy/index.js`: Database proxy service
- `processing/investigation-agent/agent.py`: Investigation agent CLI

**Configuration:**
- `docker-compose.yml`: Core service definitions (12 containers)
- `docker-compose.processing.yml`: Processing pipeline (24 text extractors, 2 embedding generators, 2 entity extractors, 2 R2 uploaders, entity resolution, classifier, investigation agent)
- `openclaw/config/mcp-servers.json`: MCP server configuration for AI agent
- `config/nginx/conf.d/default.conf`: Nginx routing rules
- `config/postgres/init/01-schema.sql`: Database schema
- `cloudflare-worker/tsconfig.json`: Worker TypeScript config
- `frontend/components.json`: shadcn-svelte component config
- `.github/workflows/deploy-frontend.yml`: CI/CD pipeline

**Core Logic:**
- `frontend/src/routes/api/search/+server.ts`: Multi-mode search (fulltext, semantic, hybrid with RRF)
- `frontend/src/routes/api/chat/+server.ts`: RAG chat with streaming SSE
- `frontend/src/routes/api/graph/+server.ts`: Neo4j graph queries (search, neighbors, shortest path)
- `frontend/src/lib/server/db.ts`: PostgreSQL proxy client
- `frontend/src/lib/server/neo4j.ts`: Neo4j proxy client
- `frontend/src/lib/server/qdrant.ts`: Qdrant proxy client
- `cloudflare-worker/api-backend/fast-processor.js`: Parallel document processing engine

**Type Definitions:**
- `frontend/src/lib/types/index.ts`: All shared TypeScript interfaces (Document, SearchResult, Entity, GraphNode, ChatMessage, Citation)
- `frontend/src/app.d.ts`: SvelteKit app type declarations

**Testing:**
- No test files detected in the codebase. Testing infrastructure is absent.

## Naming Conventions

**Files:**
- SvelteKit routes: `+page.svelte`, `+page.server.ts`, `+server.ts`, `+layout.svelte`
- Svelte components: `PascalCase.svelte` (e.g., `ChatInput.svelte`, `SearchResults.svelte`)
- UI primitives: `kebab-case.svelte` (shadcn pattern, e.g., `card-header.svelte`)
- TypeScript modules: `camelCase.ts` or `kebab-case.ts`
- Python modules: `snake_case.py`
- Barrel exports: `index.ts`

**Directories:**
- Features: `kebab-case` (e.g., `document-viewer`, `chat`)
- UI components: `kebab-case` (e.g., `hover-card`, `command`)
- Processing pipelines: `kebab-case` (e.g., `text-extractor`, `entity-resolution`)
- Route groups: `(parenthesized)` for SvelteKit layout groups (e.g., `(app)`)

## Where to Add New Code

**New Frontend Feature:**
- Create feature directory: `frontend/src/lib/features/<feature-name>/`
- Add components: `frontend/src/lib/features/<feature-name>/components/`
- Add store: `frontend/src/lib/features/<feature-name>/stores.svelte.ts`
- Add route: `frontend/src/routes/(app)/<feature-name>/+page.svelte`
- Add API route: `frontend/src/routes/api/<feature-name>/+server.ts`
- Add types: Extend `frontend/src/lib/types/index.ts`

**New UI Component:**
- Shared/reusable: `frontend/src/lib/components/ui/<component-name>/`
- Layout component: `frontend/src/lib/components/layout/`
- Use shadcn-svelte conventions: kebab-case directory, barrel `index.ts`

**New Processing Pipeline:**
- Create directory: `processing/<pipeline-name>/`
- Add `Dockerfile` in that directory
- Add service definition in `docker-compose.processing.yml`
- Use `FOR UPDATE SKIP LOCKED` pattern for parallel safety
- Include `WORKER_ID` environment variable for multi-instance support

**New API Endpoint (Edge):**
- Add route in `cloudflare-worker/src/index.ts`
- Use `X-API-Key` check for internal endpoints
- Follow existing pattern: try/catch, return JSON with `requestId`

**New API Endpoint (Frontend BFF):**
- Add route file: `frontend/src/routes/api/<path>/+server.ts`
- Use `platform.env` for configuration
- Use `frontend/src/lib/server/db.ts`, `neo4j.ts`, or `qdrant.ts` for data access

**New Database Client (Frontend):**
- Add to `frontend/src/lib/server/`
- Follow factory pattern: `export function clientName(platform: App.Platform) { ... }`
- Route through MCP HTTP Proxy at `API_BASE_URL`

**New Infrastructure Script:**
- Add to `scripts/`
- Follow numbered prefix convention for setup scripts (`01-`, `02-`, etc.)

**Utilities:**
- Frontend helpers: `frontend/src/lib/utils/index.ts`
- Processing utilities: Place in relevant pipeline directory

## Special Directories

**`data/`:**
- Purpose: Persistent Docker volumes (postgres, qdrant, neo4j, redis)
- Generated: Yes (by Docker)
- Committed: No (gitignored)

**`backups/`:**
- Purpose: Database backup storage
- Generated: Yes (by backup scripts)
- Committed: No (gitignored)

**`logs/`:**
- Purpose: Application logs (nginx, neo4j)
- Generated: Yes (by services)
- Committed: No (gitignored)

**`frontend/.svelte-kit/`:**
- Purpose: SvelteKit build artifacts
- Generated: Yes (by `vite build`)
- Committed: No (gitignored)

**`frontend/node_modules/`, `cloudflare-worker/node_modules/`:**
- Purpose: Dependencies
- Generated: Yes (by `npm install`)
- Committed: No (gitignored)

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: By analysis tools
- Committed: Yes

---

*Structure analysis: 2026-03-07*
