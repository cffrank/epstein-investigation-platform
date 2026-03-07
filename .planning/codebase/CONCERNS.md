# Codebase Concerns

**Analysis Date:** 2026-03-07

## Tech Debt

**API Backend is a 1693-line monolith:**
- Issue: `cloudflare-worker/api-backend/index.js` is a single 1693-line file containing all REST endpoints: search, documents, graph, intelligence, processing, embeddings, R2 sync, and stats. No modular separation.
- Files: `cloudflare-worker/api-backend/index.js`
- Impact: Difficult to maintain, test, or modify individual endpoints. Every change risks breaking unrelated functionality.
- Fix approach: Split into route modules (e.g., `routes/search.js`, `routes/graph.js`, `routes/documents.js`) and import into main app.

**Frontend sends raw SQL to MCP proxy:**
- Issue: `frontend/src/lib/server/db.ts` constructs full SQL strings in the frontend server-side code and sends them via HTTP to `mcp-http-proxy/index.js`. The proxy validates only that the query starts with `SELECT` or `WITH`. The frontend has deep knowledge of PostgreSQL schema, JSONB paths, and functions.
- Files: `frontend/src/lib/server/db.ts`, `mcp-http-proxy/index.js:166-187`
- Impact: Tight coupling between frontend and database schema. SQL injection risk if parameter handling is inconsistent. Makes schema migrations dangerous.
- Fix approach: Create named API endpoints in the proxy that encapsulate SQL queries. Frontend sends structured requests (e.g., `{action: "searchDocuments", filters: {...}}`).

**Duplicated logic between API routes and page server loads:**
- Issue: Entity profile fetching logic is duplicated nearly verbatim between the API route and the page server load.
- Files: `frontend/src/routes/api/entities/[id]/+server.ts`, `frontend/src/routes/(app)/entities/[id]/+page.server.ts`
- Impact: Bug fixes must be applied in two places. Logic drift between the two implementations.
- Fix approach: Extract shared service modules under `frontend/src/lib/server/services/`.

**Redundant search implementations:**
- Issue: Two independent search systems exist -- one in the Cloudflare Worker (`cloudflare-worker/src/index.ts:119-204`) and one in the frontend (`frontend/src/routes/api/search/+server.ts`). The frontend appears to be the actively used one.
- Files: `cloudflare-worker/src/index.ts`, `frontend/src/routes/api/search/+server.ts`
- Impact: Maintenance burden. Confusion about which is canonical. Different behavior between the two.
- Fix approach: Remove or repurpose the Worker search endpoint. Make the frontend's search the canonical path.

**Duplicated type definitions:**
- Issue: CytoscapeElement/CytoscapeEdge interfaces defined identically in two files. A separate GraphNode/GraphEdge type exists in `$lib/types` with a different shape and appears unused.
- Files: `frontend/src/routes/api/graph/+server.ts:5-21`, `frontend/src/lib/features/graph/stores.svelte.ts`
- Impact: Type drift, confusion about canonical types.
- Fix approach: Consolidate to one canonical graph data type in `frontend/src/lib/types/`.

**Queue consumer is a no-op:**
- Issue: The Cloudflare Worker queue handler silently acks all messages without processing them. Enqueue endpoints (`/queue/documents`, `/queue/scan-unprocessed`) still exist, giving false success responses.
- Files: `cloudflare-worker/src/index.ts:1088-1094`
- Impact: Users calling queue endpoints believe work is being done when it is not.
- Fix approach: Remove the enqueue endpoints or add clear deprecation responses.

**Docker Compose uses deprecated `version` field:**
- Issue: Both compose files use the deprecated `version: '3.8'` field.
- Files: `docker-compose.yml:1`, `docker-compose.processing.yml:1`
- Impact: Warning noise, eventual removal in future Docker versions.
- Fix approach: Remove the `version` field.

## Known Bugs

**Hardcoded API key in batch processor script:**
- Symptoms: `scripts/batch-processor.sh` contains `API_KEY="test-api-key-12345"` on line 9, a known test credential.
- Files: `scripts/batch-processor.sh:9`
- Trigger: Running the script uses this hardcoded key instead of a real one.
- Workaround: Manually set the env var before running.

**Entity page runs 3 sequential Neo4j queries:**
- Symptoms: Entity detail page (`/entities/[id]`) takes ~900ms+ because it runs profile, documents, and co-occurrences queries sequentially.
- Files: `frontend/src/routes/(app)/entities/[id]/+page.server.ts:29-127`
- Trigger: Loading any entity page.
- Workaround: None. Use `Promise.all()` to parallelize the three queries.

**Chat context grows unbounded:**
- Symptoms: Full message history including long AI responses is sent to OpenAI on every turn. After a few exchanges, payload reaches 30-50K tokens, increasing cost and latency.
- Files: `frontend/src/lib/features/chat/stores.svelte.ts:42`
- Trigger: Extended chat conversations.
- Workaround: None. Limit to last 6 messages and truncate prior assistant messages.

**Chat SSE causes full array copy on every token:**
- Symptoms: `messages = [...messages]` triggers on every streaming token (500+ per response), causing excessive re-renders.
- Files: `frontend/src/lib/features/chat/stores.svelte.ts:58-59`
- Trigger: Any chat response streaming.
- Workaround: Debounce updates with `requestAnimationFrame`.

**Frontend TypeScript errors remain:**
- Symptoms: ~20 TypeScript errors remain in the frontend, primarily in search null filtering, type predicates, and graph page type narrowing.
- Files: `frontend/src/routes/api/search/+server.ts`, `frontend/src/routes/(app)/graph/+page.svelte`
- Trigger: Running `npx svelte-check`.
- Workaround: CI may fail on these errors during deployment.

## Security Considerations

**Cypher injection in graph traversal:**
- Risk: The `/graph/traverse` endpoint in the API backend interpolates user-provided `relationshipTypes` directly into a Cypher query string without sanitization: `` `[:${relationshipTypes.join('|')}*1..${safeDepth}]` ``.
- Files: `cloudflare-worker/api-backend/index.js:660-662`
- Current mitigation: None.
- Recommendations: Validate `relationshipTypes` against an allowlist of known relationship types (e.g., `MENTIONED_IN`, `ASSOCIATED_WITH`, etc.).

**Cypher query blocklist easily bypassed:**
- Risk: The `/graph/query` endpoint blocks `delete`, `remove`, `create`, `merge`, `set` keywords but not `CALL` (APOC procedures), `DETACH`, or Unicode equivalents. APOC is enabled on the Neo4j instance.
- Files: `cloudflare-worker/api-backend/index.js:617-621`
- Current mitigation: Basic keyword blocklist.
- Recommendations: Use a Neo4j read-only user for query endpoints. Keyword blocklisting is fundamentally insufficient.

**Cypher injection via entity type interpolation:**
- Risk: Entity `type` is interpolated into Cypher: `` MATCH (n:${type}) ``. Currently mitigated by allowlist but uses string interpolation rather than parameterization.
- Files: `frontend/src/routes/api/entities/+server.ts:42-54`
- Current mitigation: Allowlist check on line 43.
- Recommendations: Use parameterized Cypher with `labels()` function instead.

**Authentication bypass in frontend hooks:**
- Risk: `hooks.server.ts` reads `Cf-Access-Authenticated-User-Email` but never blocks unauthenticated requests. All API routes proceed regardless.
- Files: `frontend/src/hooks.server.ts:1-11`
- Current mitigation: Relies entirely on Cloudflare Access being correctly configured.
- Recommendations: Add enforcement: `if (event.url.pathname.startsWith('/api/') && !event.locals.user) return new Response('Unauthorized', { status: 401 })`.

**Stored XSS via search snippets:**
- Risk: `{@html result.snippet}` renders PostgreSQL `ts_headline` output without sanitization. Document text from the 961K corpus could contain malicious HTML/JS.
- Files: `frontend/src/lib/features/search/components/SearchResults.svelte:63`
- Current mitigation: None.
- Recommendations: Use DOMPurify: `{@html DOMPurify.sanitize(result.snippet, { ALLOWED_TAGS: ['mark'] })}`.

**Stored XSS via chat message rendering:**
- Risk: AI responses are rendered via `{@html renderContent(message.content)}` after regex citation formatting. Document content surfaced by the AI could contain HTML.
- Files: `frontend/src/lib/features/chat/components/ChatMessage.svelte:13-17, 39`
- Current mitigation: None.
- Recommendations: Escape HTML before applying citation regex: `content.replace(/&/g, '&amp;').replace(/</g, '&lt;')`.

**Stored XSS in TextView search highlighting:**
- Risk: Search highlighting regex in `buildHighlightedHtml` operates on mixed HTML strings. Search terms matching across tag boundaries could corrupt HTML structure.
- Files: `frontend/src/lib/features/document-viewer/components/TextView.svelte:86-96`
- Current mitigation: Entity text is escaped via `escapeHtml()`, but search term highlighting operates on the already-HTML-mixed string.
- Recommendations: Apply search highlighting at the text level before HTML construction, in a single pass.

**API key auth silently disabled in backend when key is empty:**
- Risk: The API backend's `requireApiKey` middleware skips validation when `API_SECRET_KEY` is falsy: `if (API_SECRET_KEY && apiKey !== API_SECRET_KEY)`.
- Files: `cloudflare-worker/api-backend/index.js:54-59`
- Current mitigation: The MCP proxy was fixed to fail-closed (`mcp-http-proxy/index.js:19-23`), but the API backend was NOT.
- Recommendations: Add `if (!API_SECRET_KEY) { process.exit(1); }` to the API backend startup, matching the MCP proxy pattern.

**MCP server defaults to public IP without SSL:**
- Risk: Falls back to `host: '88.99.61.233'` with `ssl: false` if `PG_HOST` is unset, sending database credentials in cleartext over the internet.
- Files: `cloudflare-worker/mcp-servers/epstein-documents/index.js:15`
- Current mitigation: None.
- Recommendations: Default to `localhost` and require SSL when connecting to non-localhost hosts.

**Redis has no authentication:**
- Risk: No `--requirepass` configured. Any container on the Docker network can access Redis without credentials.
- Files: `docker-compose.yml:225`
- Current mitigation: Redis port is bound to 127.0.0.1 on the host.
- Recommendations: Add `--requirepass ${REDIS_PASSWORD}` to the Redis command.

**Node-exporter has full host filesystem access:**
- Risk: Mounts `/:/host:ro,rslave` with `pid: host`, exposing all files on the host including `.env` secrets.
- Files: `docker-compose.yml:277-278`
- Current mitigation: Read-only mount.
- Recommendations: Mount only `/proc`, `/sys`, and `/rootfs` separately.

**Missing security headers in nginx:**
- Risk: Missing HSTS, CSP, Referrer-Policy, Permissions-Policy headers.
- Files: `config/nginx/conf.d/default.conf:14-15`
- Current mitigation: Only X-Frame-Options and X-Content-Type-Options are set.
- Recommendations: Add comprehensive security headers.

**Error messages leak internal details:**
- Risk: 20+ locations in `cloudflare-worker/api-backend/index.js` return `error.message` directly to clients, revealing schema details and internal paths.
- Files: `cloudflare-worker/api-backend/index.js` (throughout, e.g., lines 320, 342, 372, 641, 694)
- Current mitigation: None.
- Recommendations: Return generic error messages to clients. Log detailed errors server-side only.

## Performance Bottlenecks

**ILIKE full table scans on 961K documents:**
- Problem: Three endpoints use `metadata->>'extracted_text' ILIKE '%name%'` for person mention counting and document search with leading wildcards, forcing sequential scans.
- Files: `cloudflare-worker/api-backend/index.js:330-343, 352-362`
- Cause: Leading-wildcard ILIKE cannot use indexes. The `search_vector` tsvector column exists but is not used in these endpoints.
- Improvement path: Replace ILIKE queries with `search_vector @@ plainto_tsquery()` or query Neo4j for entity-related lookups.

**Fulltext search COUNT query scans entire match set:**
- Problem: `fulltextSearch` runs `COUNT(*)` with the same full-text WHERE clause as the paginated query, scanning all matching rows twice.
- Files: `frontend/src/routes/api/search/+server.ts:101-105`
- Cause: Exact count computation for pagination.
- Improvement path: Use a capped count CTE: `WITH limited AS (SELECT 1 FROM documents WHERE ... LIMIT 10001) SELECT COUNT(*) FROM limited`.

**Hybrid search does 2x work, discards most results:**
- Problem: Fetches `limit * 2` from both fulltext and semantic search (including redundant COUNT queries and an OpenAI embedding call), then merges via RRF and discards most.
- Files: `frontend/src/routes/api/search/+server.ts:281-330`
- Cause: Over-fetching to ensure RRF merge has enough candidates.
- Improvement path: Skip COUNT in fulltext leg when called from hybrid. Cache embeddings for identical queries.

**Semantic search over-fetches from Qdrant:**
- Problem: Fetches `limit + offset` results from Qdrant then slices. Page 10 fetches 220 vectors to show 20.
- Files: `frontend/src/routes/api/search/+server.ts:189-191`
- Cause: Not using Qdrant's native `offset` parameter.
- Improvement path: Use Qdrant's native `offset` parameter in the search call.

**PostgreSQL connection pool exhaustion risk:**
- Problem: 4 backend instances (default 10 each) + MCP proxy (20) + fast-processor (30) = 90+ connections against PostgreSQL default 100.
- Files: `cloudflare-worker/api-backend/index.js:22-29`, `mcp-http-proxy/index.js:15`
- Cause: No coordinated pool sizing across services.
- Improvement path: Configure explicit `max` pool sizes and increase `max_connections` in PostgreSQL config.

**R2 key sync uses N+1 individual UPDATE queries:**
- Problem: Each R2 key requires 1-2 queries. 1000 keys = 2000 queries.
- Files: `cloudflare-worker/api-backend/index.js:181-216`
- Cause: Individual UPDATE per key rather than bulk operation.
- Improvement path: Bulk UPDATE with `unnest()`.

**Qdrant over-provisioned:**
- Problem: 24GB memory allocated for ~67K vectors at 1536 dims = ~402MB of actual data.
- Files: `docker-compose.yml:185`
- Cause: Initial provisioning was generous.
- Improvement path: Reduce to 4-8GB and monitor. Reallocate freed memory to PostgreSQL.

## Fragile Areas

**Frontend platform/env null checking is inconsistent:**
- Files: `frontend/src/routes/api/search/+server.ts:23`, `frontend/src/routes/api/chat/+server.ts:26`, `frontend/src/routes/api/graph/+server.ts:24`, `frontend/src/routes/(app)/entities/[id]/+page.server.ts:14`
- Why fragile: Some routes check `!platform`, some check `!platform?.env`, some return empty data, some throw 500. Inconsistent null handling means bugs appear differently across routes.
- Safe modification: Create shared `assertPlatform()` utility in `frontend/src/lib/server/` that throws consistently.
- Test coverage: Zero automated tests.

**Nginx routing determines security boundaries:**
- Files: `config/nginx/conf.d/default.conf`
- Why fragile: Adding a new location block without IP restrictions would expose internal services. The `/api/` route has no IP restriction and passes through to backends that may have unprotected endpoints.
- Safe modification: Always add `allow 172.16.0.0/12; deny all;` to new internal-only locations. Document which routes are public vs internal.
- Test coverage: Zero tests. Manual verification only.

**API backend auth middleware is applied selectively:**
- Files: `cloudflare-worker/api-backend/index.js:54-60`
- Why fragile: `requireApiKey` is applied per-route. New endpoints added without it will be unauthenticated. The middleware itself fails open when `API_SECRET_KEY` is empty.
- Safe modification: Apply auth middleware globally and explicitly exclude public endpoints.
- Test coverage: Zero tests.

## Scaling Limits

**Document corpus at 961K+:**
- Current capacity: 961,433 documents in PostgreSQL
- Limit: ILIKE queries already take 10-30s. Full-text search COUNT queries double latency. As corpus grows, these will worsen linearly.
- Scaling path: Replace all ILIKE with tsvector search. Use capped counts. Add materialized views for common aggregations.

**Neo4j entity graph at 88K+ entities:**
- Current capacity: 88K entities, 917K relationships
- Limit: Community detection and centrality algorithms will become slow at 500K+ entities.
- Scaling path: Use GDS library for algorithm execution. Pre-compute and cache results.

## Dependencies at Risk

**Chat uses GPT-4o-mini (planned migration to Claude):**
- Risk: ROADMAP TASK-2.2 plans to replace OpenAI chat with Claude Sonnet. Current implementation uses OpenAI streaming format. Migration will require SSE parser changes.
- Impact: Chat feature rewrite needed for Claude migration.
- Migration plan: Already documented in `ROADMAP.md` TASK-2.2.

## Missing Critical Features

**Zero automated tests across entire project:**
- Problem: No test files, no test runner (vitest/jest/pytest), no test dependencies, no test stage in CI/CD pipeline. The only CI workflow (`deploy-frontend.yml`) runs `svelte-check` and `npm run build` but no tests.
- Blocks: Safe refactoring, regression detection, confidence in deployments.

**No CI/CD for backend, Worker, or infrastructure:**
- Problem: Only the frontend has a CI/CD workflow (`.github/workflows/deploy-frontend.yml`). The Cloudflare Worker, Docker infrastructure, API backend, and processing pipelines have no automated deployment or testing.
- Blocks: Automated deployments, deployment confidence, rollback capability.

**No authentication enforcement:**
- Problem: Authentication relies entirely on Cloudflare Access headers being present. No server-side enforcement exists in the frontend hooks or API routes.
- Blocks: Defense-in-depth security posture.

## Test Coverage Gaps

**No tests exist anywhere in the project:**
- What's not tested: Everything. SQL query construction, SSE parsing, auth guards, search logic, graph traversal, chat streaming, entity resolution, document processing.
- Files: All source files in `frontend/src/`, `cloudflare-worker/`, `mcp-http-proxy/`, `processing/`
- Risk: Every code change deploys without automated verification. Logic bugs, security regressions, and data handling errors reach production undetected.
- Priority: High. Start with: (1) SQL query construction in search routes, (2) SSE parser in `frontend/src/lib/features/chat/sse.ts`, (3) auth middleware in API backend, (4) Cypher query sanitization.

## Summary of Open Code Review Findings

The code review from 2026-03-07 (`docs/CODE-REVIEW-2026-03-07.md`) identified 38 findings. Status of critical items:

| Finding | Status | Notes |
|---------|--------|-------|
| CR-001 MCP proxy public access | **Fixed** | IP restriction + requireAuth added |
| CR-002 Cypher injection | **Open** | `cloudflare-worker/api-backend/index.js:660-662` |
| CR-003 ILIKE full table scans | **Open** | `cloudflare-worker/api-backend/index.js:330-362` |
| CR-004 Zero automated tests | **Open** | No test infrastructure exists |
| CR-005 Fulltext COUNT scan | **Open** | `frontend/src/routes/api/search/+server.ts:101-105` |
| CR-006 Auth bypass in hooks | **Open** | `frontend/src/hooks.server.ts` |
| CR-007 Auth fail-open on empty key | **Partially fixed** | MCP proxy fixed, API backend still open |
| HI-001 XSS search snippets | **Open** | `SearchResults.svelte:63` |
| HI-002 XSS chat messages | **Open** | `ChatMessage.svelte:39` |
| HI-005 Hardcoded API key | **Open** | `scripts/batch-processor.sh:9` |
| HI-006 MCP default to public IP | **Open** | `epstein-documents/index.js:15` |

---

*Concerns audit: 2026-03-07*
