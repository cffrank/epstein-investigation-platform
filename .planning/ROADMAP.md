# Roadmap: Epstein Investigation Platform -- Phase 2 Intelligence Layer

## Overview

Transform the platform from a document search tool into an investigative intelligence system. Security vulnerabilities get closed first (no new attack surface on a broken foundation), then features ship in dependency order: AI chat (highest impact, unblocks AI bios), entity dossiers (highest visibility, assembles existing data), faceted search (daily-use improvement), graph analysis (analytical differentiator, requires GDS plugin), timeline (requires date extraction pipeline), and document analysis pipelines (background processing, lowest priority).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Security and Foundation** - Close critical vulnerabilities, fix performance bottlenecks, establish test infrastructure and CI
- [ ] **Phase 2: AI Chat with Tool Use** - Replace OpenAI chat with Claude-powered investigation assistant that queries all three databases
- [ ] **Phase 3: Entity Dossier Pages** - Rich entity profiles with documents, connections, timeline, AI biography, and analyst notes
- [ ] **Phase 4: Faceted Search and Export** - Content type filters, entity mention filters, date range presets, saved searches, and result export
- [ ] **Phase 5: Graph Analysis** - PageRank, community detection, bridge nodes, hidden connections, and visual algorithm overlays
- [ ] **Phase 6: Timeline Visualization** - Date extraction pipeline and interactive zoomable timeline with entity filtering
- [ ] **Phase 7: Document Analysis Pipelines** - Redaction detection, cross-reference resolution, and document linking

## Phase Details

### Phase 1: Security and Foundation
**Goal**: The platform is hardened against known vulnerabilities and has automated quality gates so new features ship on a secure, stable base
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, SEC-11, SEC-12, SEC-13, SEC-14, SEC-15, SEC-16
**Success Criteria** (what must be TRUE):
  1. No user-supplied input reaches Cypher or SQL without parameterization -- Cypher injection (CR-002), APOC bypass (HI-004), and raw SQL proxy (HI-012) are all closed
  2. All `{@html}` renders pass through DOMPurify and unauthenticated users cannot reach any frontend route
  3. Search queries on 961K documents return within 2 seconds (ILIKE replaced, COUNT optimized, hybrid search tuned)
  4. Vitest runs in CI on every push with passing tests for SQL builders, auth guards, and SSE parser
  5. Frontend compiles with zero TypeScript errors
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md -- Monorepo workspace + @epstein/shared package (query builders, auth guards, types)
- [x] 01-02-PLAN.md -- Security hardening (injection, XSS, auth, safe defaults, SQL proxy replacement)
- [x] 01-03-PLAN.md -- Performance optimization (FTS, capped counts, hybrid search, chat context, batch parallelization)
- [x] 01-04-PLAN.md -- Test infrastructure + CI/CD pipeline + TypeScript error cleanup

### Phase 2: AI Chat with Tool Use
**Goal**: An investigator can have a natural-language conversation with Claude that searches documents, queries entities, and traverses the graph -- with every claim citing specific documents
**Depends on**: Phase 1
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09, CHAT-10, CHAT-11
**Success Criteria** (what must be TRUE):
  1. User can start a chat conversation and receive streaming responses from Claude via Anthropic SDK routed through Cloudflare AI Gateway
  2. User can switch between Claude Sonnet and Opus models in chat settings and the model change takes effect on the next message
  3. Claude autonomously calls search_documents, semantic_search, get_entity_profile, graph_query, and find_connections tools during conversation -- user sees tool use indicators in the stream
  4. Every factual claim in Claude's responses includes clickable document ID citations that open the document viewer
  5. Chat context stays bounded (sliding window of last 6 messages + current turn tools) and AI-generated content displays a disclaimer
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Entity Dossier Pages
**Goal**: An investigator can view a comprehensive profile for any entity -- documents, connections, timeline, AI-generated biography, and their own notes -- in a single tabbed interface
**Depends on**: Phase 2 (AI biography generation depends on Claude chat API)
**Requirements**: ENTY-01, ENTY-02, ENTY-03, ENTY-04, ENTY-05, ENTY-06
**Success Criteria** (what must be TRUE):
  1. Entity page displays header with name, type, aliases, document mention count, and connection count pulled from PostgreSQL and Neo4j
  2. Documents tab shows all documents mentioning the entity with search and filter, and connections tab shows Neo4j neighbors with relationship types and weights
  3. Timeline tab shows entity-related events in chronological order and AI biography tab displays a Claude-generated synthesis of corpus mentions (cached per entity)
  4. User can add, edit, and delete analyst investigation notes on any entity and see them persist across sessions
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Faceted Search and Export
**Goal**: An investigator can narrow search results using content type, entity, and date filters -- and save searches or export results for offline analysis
**Depends on**: Phase 1 (search performance fixes)
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05
**Success Criteria** (what must be TRUE):
  1. User can filter search results by document classification (court filing, correspondence, financial, etc.) and by entity mentions
  2. User can filter search results by date range using presets (year, decade) or a custom date picker
  3. User can save a search query with all active filters and re-execute it from a saved searches list
  4. User can export the current search result set to CSV or JSON and download the file
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: Graph Analysis
**Goal**: An investigator can run graph algorithms to identify influential entities, communities, bridge nodes, and hidden connections -- with results visually reflected in the graph
**Depends on**: Phase 1 (Cypher injection fixes)
**Requirements**: GRPH-01, GRPH-02, GRPH-03, GRPH-04, GRPH-05
**Success Criteria** (what must be TRUE):
  1. User can trigger PageRank computation and see entities ranked by influence score, with node sizes in the graph visualization reflecting centrality
  2. User can run Louvain community detection and see entity clusters color-coded in the graph visualization
  3. User can run betweenness centrality to identify bridge nodes and discover hidden connections (entity pairs sharing neighbors but lacking a direct edge)
  4. Algorithm results are pre-computed in batch and served from cache -- no on-demand GDS execution per request
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Timeline Visualization
**Goal**: An investigator can explore a chronological view of events extracted from the document corpus, filtered by entity
**Depends on**: Phase 1 (batch processing infrastructure)
**Requirements**: TIME-01, TIME-02, TIME-03
**Success Criteria** (what must be TRUE):
  1. Date extraction pipeline has processed documents and populated an events table with extracted dates, event types, and confidence scores
  2. User can view an interactive zoomable timeline that spans decade-to-day granularity, with events plotted chronologically
  3. User can filter the timeline by one or more entities to see only events involving those entities
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Document Analysis Pipelines
**Goal**: The platform automatically detects redactions and resolves cross-references across documents so investigators can identify information gaps and navigate document chains
**Depends on**: Phase 1 (batch processing infrastructure)
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. Redaction detection pipeline identifies [REDACTED], [SEALED], and blackout patterns in documents and stores annotations
  2. User can view redaction annotations on document pages with inconsistency flags (e.g., same content redacted in one document but visible in another)
  3. Cross-reference resolution pipeline links exhibit references and Bates numbers across documents
  4. User can click a cross-reference in one document and navigate directly to the linked document
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security and Foundation | 4/4 | Complete | 2026-03-07 |
| 2. AI Chat with Tool Use | 0/2 | Not started | - |
| 3. Entity Dossier Pages | 0/2 | Not started | - |
| 4. Faceted Search and Export | 0/1 | Not started | - |
| 5. Graph Analysis | 0/2 | Not started | - |
| 6. Timeline Visualization | 0/1 | Not started | - |
| 7. Document Analysis Pipelines | 0/1 | Not started | - |
