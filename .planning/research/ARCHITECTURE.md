# Architecture Research: Phase 2 Intelligence Layer Integration

**Date:** 2026-03-07
**Confidence:** HIGH (based on existing codebase map + PRD)

## How Phase 2 Features Integrate with Existing Architecture

### AI Chat with Tool Use (AI-01 through AI-06)

**Integration point:** `frontend/src/routes/api/chat/+server.ts` (rewrite)

**Data flow:**
1. Frontend sends message to SvelteKit API route
2. API route calls Anthropic API via **Cloudflare AI Gateway** (not direct)
3. Claude returns tool_use blocks -> server executes tools against databases via MCP proxy
4. Tool results sent back to Claude -> Claude generates text response
5. Text streamed to frontend via SSE

**Key constraint:** All AI API calls (Anthropic, OpenAI) must route through Cloudflare AI Gateway for monitoring, rate limiting, and key management.

**SSE on Cloudflare Pages:** Research indicates potential buffering issues. The existing chat already uses SSE successfully, so the current approach works. Monitor after switching to Anthropic SDK.

**Dependencies:** MCP proxy for database access, Qdrant for semantic search, Neo4j for graph queries, PostgreSQL for document search.

### Entity Dossier Pages (E-02 through E-07)

**Integration point:** `frontend/src/routes/(app)/entities/[id]/+page.server.ts` (modify)

**Data aggregation pattern:** Single page server load fetches from 3 databases in parallel:
- PostgreSQL: entity metadata, documents via `document_entities` JOIN, investigation notes
- Neo4j: direct connections, relationship types
- Qdrant: (not needed directly — documents already hydrated from PostgreSQL)

**Recommended:** Use `Promise.all()` for parallel queries (fixes ME-010). Extract into shared service module (fixes HI-011).

### Graph Analysis (G-01 through G-04)

**Integration point:** `frontend/src/routes/api/graph/+server.ts` (modify)

**Algorithm execution:** Two options researched:
1. **Neo4j GDS plugin** — Full PageRank, Louvain, betweenness centrality. Requires Docker Compose change + memory monitoring.
2. **APOC algorithms** — `apoc.algo.pageRank`, `apoc.algo.community` (label propagation). Already installed, deprecated but functional.

**Recommendation:** Install GDS plugin for production-quality algorithms. Pre-compute results in batch (write to node properties), serve pre-computed results via API. Do NOT run algorithms on-demand per request.

**Critical:** Run algorithms on entity-type-specific subgraphs (Person-only for social analysis). Mixed types produce nonsensical results.

### Faceted Search (S-01 through S-05)

**Integration point:** `frontend/src/routes/api/search/+server.ts` (modify)

**Pattern:** Add filter parameters to existing search SQL. Content classification filter uses `metadata->>'content_classification'` (populated in Phase 1). Entity mention filter uses `document_entities` JOIN. Saved searches stored in new `saved_searches` table.

**No new infrastructure needed.** Pure frontend + SQL changes.

### Timeline Visualization (T-01 through T-03)

**Integration point:** New route `frontend/src/routes/(app)/timeline/`

**Pipeline:** Processing script extracts dates from document text (regex + LLM via Cloudflare AI Gateway), stores in new `events` table. Frontend D3.js component renders zoomable timeline.

**Build order:** Start date extraction pipeline early (background processing), build UI after data is available.

### Redaction & Cross-Reference Detection (D-02, D-03)

**Integration point:** New processing scripts, new `document_references` table

**Pattern:** Independent batch processing pipelines following existing `FOR UPDATE SKIP LOCKED` pattern. Results stored in PostgreSQL metadata/tables. No frontend changes needed initially.

## Suggested Build Order

1. **Security fixes** — prerequisite, no new attack surface until existing holes closed
2. **Test infrastructure** — vitest setup, CI gate
3. **AI Chat** — most complex backend change, unblocks AI entity biographies
4. **Entity Dossiers** — highest visibility, data exists from Phase 1
5. **Faceted Search** — daily-use improvement, builds on Phase 1 classification
6. **Graph Analysis** — GDS plugin install + pre-computation + UI
7. **Timeline** — date extraction pipeline runs in background while UI is built
8. **Redaction/Cross-Ref** — independent pipelines, lowest priority

## Infrastructure Changes Required

| Change | Service | Risk | Phase |
|--------|---------|------|-------|
| Install Neo4j GDS plugin | Neo4j | Medium (memory) | Before graph analysis |
| Add `@anthropic-ai/sdk` to frontend | Frontend | Low | Before AI chat |
| Configure AI Gateway for Anthropic | Cloudflare | Low | Before AI chat |
| New `events` table | PostgreSQL | Low | Before timeline |
| New `saved_searches` table | PostgreSQL | Low | Before faceted search |
| New `document_references` table | PostgreSQL | Low | Before cross-ref detection |

---
*Architecture research: 2026-03-07*
