# Project Research Summary

**Project:** Epstein Investigation Platform -- Phase 2 Intelligence Layer
**Domain:** Investigative intelligence platform (document corpus analysis, 961K+ documents)
**Researched:** 2026-03-07
**Confidence:** HIGH

## Executive Summary

The Epstein Investigation Platform is transitioning from a document search tool (Phase 1) into an investigative intelligence platform (Phase 2). The existing infrastructure -- PostgreSQL (961K docs), Qdrant (vector search), Neo4j (88K entities, 917K relationships), and a SvelteKit frontend -- provides a solid foundation. Phase 2 adds six major feature groups: AI chat with Claude tool use, entity dossier pages, faceted search, graph analysis algorithms, timeline visualization, and document analysis pipelines (redaction/cross-reference detection). Research confirms this is achievable with minimal new dependencies: the Anthropic TypeScript SDK, five D3 modular packages, the Neo4j GDS plugin, and Vitest for testing.

The recommended approach is security-first, then feature development ordered by dependency chains and impact. AI chat with tool use is the highest-impact and most complex feature, and it unblocks AI entity biographies. Entity dossiers, faceted search, and graph analysis follow as primarily frontend assembly work on top of existing data. Timeline visualization requires a date extraction pipeline that should start early as background processing. The stack decisions are high-confidence -- all recommendations use official, well-maintained libraries with clear integration paths into the existing codebase.

The primary risks are AI hallucination presenting fabricated evidence (mitigated by mandatory document citations and disclaimers), Cypher injection through new graph endpoints (mitigated by fixing CR-002 first and using a read-only Neo4j user), and Neo4j memory exhaustion from GDS graph projections (mitigated by pre-computing algorithm results in batch on entity-type-specific subgraphs). Three critical security fixes (Cypher injection CR-002, XSS sanitization HI-001/002/003, auth enforcement CR-006/007) must be completed before any new feature endpoints are added.

## Key Findings

### Recommended Stack

Phase 2 requires remarkably few new dependencies. The existing stack (SvelteKit, PostgreSQL, Qdrant, Neo4j, Cytoscape.js, Shadcn-svelte) handles most needs. See [STACK.md](STACK.md) for full details.

**Core new technologies:**
- `@anthropic-ai/sdk` -- Claude API client with native streaming and tool use. Route through Cloudflare AI Gateway. Do NOT use Vercel AI SDK (React-oriented, unnecessary abstraction).
- `d3-scale` + `d3-time` + `d3-axis` + `d3-brush` + `d3-time-format` -- Modular D3 packages for timeline math/scales only. Svelte handles DOM. ~35KB total. Do NOT use vis-timeline (conflicts with Svelte reactivity) or LayerCake (overkill for one chart).
- Neo4j GDS plugin -- Graph Data Science for PageRank, Louvain community detection, betweenness centrality. APOC algorithms are deprecated. Requires Docker Compose change and memory monitoring.
- `vitest` + `@testing-library/svelte` -- Testing foundation. Vite-native, zero-config TypeScript support.

**Critical version/config requirements:**
- Neo4j GDS needs heap increase to 4-8GB (from default ~512MB). Consider reallocating from Qdrant's underutilized 24GB.
- Anthropic API calls MUST route through Cloudflare AI Gateway (`baseURL` override in SDK).
- Model default: `claude-sonnet-4-20250514` (cost-effective). Allow user override to Opus for complex investigations.

### Expected Features

See [FEATURES.md](FEATURES.md) for full landscape analysis.

**Must have (table stakes):**
- AI chat with database tool use -- every investigation platform has this in 2026
- Entity dossier pages -- documents, connections, timeline, AI summary in one view
- Faceted search with content type, entity, and date filters
- Search result export (CSV/JSON)
- Saved searches

**Should have (differentiators):**
- Graph analysis algorithms (PageRank, communities, bridges) -- Palantir-level analytics
- Hidden connection discovery (2-hop paths without direct edges)
- Interactive zoomable timeline with entity filtering
- Redaction detection and inconsistency flagging
- Cross-reference resolution (exhibit/Bates number linking)
- AI-generated entity biographies

**Defer to Phase 3+:**
- Investigation workspace / evidence board (complex DnD canvas UI)
- Report generator (needs workspace first)
- Face detection pipeline (needs GPU infrastructure)
- Anomaly detection (needs stable intelligence layer first)
- Real-time collaboration, multi-tenancy, mobile app

**Estimated total effort:** 26-31 days across all Phase 2 feature groups.

### Architecture Approach

Phase 2 features integrate cleanly into the existing architecture. See [ARCHITECTURE.md](ARCHITECTURE.md) for integration details.

**Major components and integration points:**
1. **AI Chat API** (`/api/chat/+server.ts` rewrite) -- Anthropic SDK with tool use loop, server-side tool execution against databases via MCP proxy, SSE streaming to frontend
2. **Entity Dossier Pages** (`/entities/[id]/+page.server.ts` modify) -- Parallel data aggregation from PostgreSQL + Neo4j using `Promise.all()`
3. **Graph Analysis API** (`/api/graph/+server.ts` modify) -- GDS algorithms pre-computed in batch, results served from PostgreSQL cache
4. **Faceted Search** (`/api/search/+server.ts` modify) -- Filter parameters added to existing search SQL, new `saved_searches` table
5. **Timeline** (new route `/timeline/`) -- Date extraction pipeline feeds `events` table, D3.js + Svelte frontend component
6. **Document Pipelines** (batch processing scripts) -- Redaction detection and cross-reference resolution using existing `FOR UPDATE SKIP LOCKED` pattern

**Key architectural pattern:** Pre-compute expensive operations (graph algorithms, date extraction) in batch. Serve cached results. Never run GDS algorithms on-demand per user request.

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for the full 13-pitfall analysis.

1. **AI hallucination as evidence** -- Every AI claim must cite specific document IDs displayed inline. Add disclaimers on all AI-generated content. Never allow the AI to state conclusions about guilt/innocence. Implement from day one of AI chat, not retrofitted.
2. **Cypher injection via new graph endpoints** -- Fix CR-002 before adding ANY graph analysis features. Create a read-only Neo4j user for all query endpoints. Validate dynamic Cypher components against strict allowlists.
3. **Stored XSS through document content** -- Install DOMPurify and create a `sanitizeHtml()` utility before building new rendering surfaces. Ban direct `{@html}` of untrusted content.
4. **Neo4j GDS memory exhaustion** -- Pre-compute algorithm results in batch on entity-type-specific subgraphs. Use `gds.pageRank.estimate()` before execution. Monitor heap usage. Start with Person-only subgraphs.
5. **Chat context cost spiral with tool use** -- Implement sliding window context (last 6 messages + current turn tools). Truncate tool results to 500 chars. Track token usage per conversation. Set 50K token budget per conversation.

## Implications for Roadmap

Based on combined research, the following phase structure is recommended. All four research files converge on the same ordering: security first, then features ordered by complexity and dependency chains.

### Phase 1: Security and Foundation

**Rationale:** All research files agree: existing security vulnerabilities (Cypher injection, XSS, auth bypass) must be fixed before adding new attack surface. PITFALLS.md flags this as non-negotiable. 20 TypeScript errors must be resolved before frontend feature work.
**Delivers:** Hardened platform ready for new feature development, test infrastructure, CI gates
**Addresses:** CR-002 (Cypher injection), HI-001/002/003 (XSS), CR-006/007 (auth), 20 TS errors, Vitest setup
**Avoids:** Pitfall 2 (injection), Pitfall 3 (XSS), Pitfall 10 (auth gaps), Pitfall 12 (TS errors compounding)

### Phase 2: AI Chat with Tool Use

**Rationale:** Highest impact feature per FEATURES.md. Most complex backend work. Unblocks AI entity biographies. ARCHITECTURE.md places this first in feature ordering.
**Delivers:** Natural-language investigation assistant with database tool use, streaming responses, citation enforcement
**Uses:** `@anthropic-ai/sdk`, Cloudflare AI Gateway, MCP proxy
**Avoids:** Pitfall 1 (hallucination -- citations from day one), Pitfall 6 (connection pool -- dedicated pool for tool calls), Pitfall 9 (context costs -- sliding window + truncation)

### Phase 3: Entity Dossier Pages

**Rationale:** Highest visibility feature. Data already exists from Phase 1 entity resolution. Primarily frontend assembly. AI biographies depend on Phase 2 chat API.
**Delivers:** Rich entity profiles with documents tab, connections tab, timeline tab, AI biography, analyst notes
**Uses:** Existing Shadcn-svelte components, Cytoscape.js for mini graph, Claude API for biographies
**Avoids:** Pitfall 1 (hallucination -- show source documents alongside AI bios)

### Phase 4: Faceted Search and Export

**Rationale:** Daily-use improvement. Builds on Phase 1 classification data. Independent of AI chat. Medium complexity.
**Delivers:** Content type filters, entity mention filters, date range presets, saved searches, CSV/JSON export
**Uses:** Existing Shadcn-svelte components, PostgreSQL full-text search
**Avoids:** Pitfall 5 (search performance -- replace ILIKE with FTS first), Pitfall 13 (saved search versioning)

### Phase 5: Graph Analysis

**Rationale:** Analytical differentiator. Requires Neo4j GDS plugin installation (infrastructure change). Memory monitoring must be in place first.
**Delivers:** PageRank, community detection, bridge node identification, hidden connection discovery, visual styling in Cytoscape
**Uses:** Neo4j GDS plugin, Cytoscape.js (existing)
**Avoids:** Pitfall 4 (memory exhaustion -- batch pre-computation), Pitfall 8 (mixed entity types -- type-specific subgraphs), Pitfall 11 (GDS concurrency -- batch off-peak)

### Phase 6: Timeline Visualization

**Rationale:** Requires date extraction pipeline (heavy background processing). Start pipeline early in parallel with other phases, build UI last. FEATURES.md rates this as high complexity.
**Delivers:** Interactive zoomable timeline (decade to day), entity-filtered event view, date extraction pipeline
**Uses:** D3 modular packages, Cloudflare Workers AI for LLM date extraction
**Avoids:** Pitfall 7 (noisy dates -- classify by type, confidence thresholds, start with high-confidence sources)

### Phase 7: Document Analysis Pipelines

**Rationale:** Independent of other features. Background processing. Lowest priority per all research files.
**Delivers:** Redaction detection, cross-reference resolution (exhibit/Bates linking)
**Uses:** Existing backend processing pattern (`FOR UPDATE SKIP LOCKED`)
**Avoids:** Pitfall 7 (same pipeline quality concerns -- validate against known documents first)

### Phase Ordering Rationale

- **Security before features:** Every research file flags security fixes as prerequisites. New endpoints without auth/injection fixes expand attack surface.
- **AI chat first among features:** Most complex backend, unblocks other features (AI bios), highest user impact.
- **Entity dossiers before search:** Higher visibility, depends on AI chat for biographies, data already exists.
- **Graph analysis after search:** Requires GDS plugin install (infrastructure risk). Search is higher daily utility.
- **Timeline near end:** Date extraction pipeline is the heaviest background job. Start it early but build UI last.
- **Document pipelines last:** Fully independent, lowest user-facing impact, pure background processing.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (AI Chat):** Tool use loop patterns, SSE format differences between OpenAI and Anthropic, context window management strategies. The Anthropic streaming format is different from the current OpenAI implementation -- `sse.ts` needs a complete rewrite, not adaptation.
- **Phase 5 (Graph Analysis):** GDS memory estimation for 88K nodes / 917K edges, optimal subgraph projection strategies, batch scheduling approach. Memory behavior under load needs testing.
- **Phase 6 (Timeline):** Date extraction accuracy on legal documents, classification of date types (event vs. filing vs. reference), confidence scoring. This is the least well-documented pattern.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Security):** Well-documented fixes. DOMPurify, read-only DB users, auth middleware -- standard security patterns.
- **Phase 3 (Entity Dossiers):** Frontend data assembly. No novel technical challenges.
- **Phase 4 (Faceted Search):** PostgreSQL filter queries, CRUD for saved searches. Standard web application patterns.
- **Phase 7 (Document Pipelines):** Regex pattern matching, existing processing infrastructure. Straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations use official, well-maintained libraries. Anthropic SDK, D3 modular, and Neo4j GDS are well-documented with clear integration paths. No speculative choices. |
| Features | HIGH | Feature landscape validated against 10+ commercial investigation platforms (Palantir, Maltego, i2, DISCO, Purview). Table stakes and differentiators clearly distinguished. |
| Architecture | HIGH | Integration points mapped to specific files in the existing codebase. No greenfield architecture -- all features extend existing patterns. |
| Pitfalls | HIGH | 13 pitfalls identified with specific prevention strategies. Critical pitfalls (hallucination, injection, XSS) backed by academic research and security documentation. |

**Overall confidence:** HIGH

### Gaps to Address

- **Neo4j GDS memory behavior:** The 88K node / 917K edge graph projection memory requirement is estimated but not tested. Run `gds.pageRank.estimate('investigation')` after GDS installation to validate before building the UI.
- **Cloudflare Pages SSE buffering:** Research notes potential buffering issues. The existing chat works with SSE, but switching to the Anthropic SDK format may behave differently. Monitor after implementation.
- **Date extraction accuracy on legal corpus:** No benchmark data for regex + LLM date extraction on court filings specifically. Start with a sample of 1,000 documents and measure precision/recall before scaling to 961K.
- **Connection pool sizing under tool use load:** Current pool usage is ~90/100. Tool use adds bursty concurrent queries. Actual impact depends on conversation patterns. May need PgBouncer if connection exhaustion occurs in practice.
- **AI Gateway Anthropic routing:** Documented by Cloudflare but not tested with the `@anthropic-ai/sdk` `baseURL` override. Validate during Phase 2 setup.

## Sources

### Primary (HIGH confidence)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) -- Tool use, streaming, Workers runtime support
- [Neo4j GDS Documentation](https://neo4j.com/docs/graph-data-science/current/) -- Algorithm catalog, memory estimation, Docker installation
- [Neo4j Cypher Injection Prevention](https://neo4j.com/developer/kb/protecting-against-cypher-injection/) -- Read-only user pattern
- [Cloudflare AI Gateway + Anthropic](https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/) -- Routing configuration
- [D3-scale Documentation](https://www.npmjs.com/package/d3-scale) -- Stable API, v4
- [Stanford Legal RAG Hallucinations Study (2025)](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf) -- 30-40% hallucination rate in reporting contexts

### Secondary (MEDIUM confidence)
- [Svelte + D3 Patterns (Vis Society 2026)](https://vis-society.github.io/lectures/intro-svelte-d3.html) -- Integration approach validation
- [Palantir Gotham](https://www.palantir.com/platforms/gotham/), [Maltego](https://www.maltego.com/), [i2 Analyst Notebook](https://i2group.com/) -- Feature landscape benchmarks
- [PostgreSQL FTS optimization (200M rows)](https://medium.com/@yogeshsherawat/using-full-text-search-fts-in-postgresql-for-over-200-million-rows-a-case-study-e0a347df14d0) -- Performance patterns at scale

### Tertiary (LOW confidence)
- GDS Community Edition memory behavior at 88K/917K scale -- estimated, not benchmarked
- Cloudflare Pages SSE buffering with Anthropic SDK -- theoretical concern, needs validation

---
*Research completed: 2026-03-07*
*Ready for roadmap: yes*
