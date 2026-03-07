# Epstein Investigation Platform

## What This Is

A full-stack investigative intelligence platform built on 1.47M documents from the Epstein case. It processes documents through a five-stage pipeline (ingestion, text extraction, OCR, embedding, entity extraction), stores them across PostgreSQL, Qdrant, and Neo4j, and provides a SvelteKit web interface for search, chat, graph exploration, and entity browsing. Currently transitioning from a document processing pipeline with a thin search UI into a comprehensive investigative tool.

## Core Value

An investigator can search, connect, and analyze 1.5M documents to discover relationships and patterns that would be impossible to find manually.

## Requirements

### Validated

- Document ingestion pipeline (1.47M documents in PostgreSQL + R2) — Phase 1
- Text extraction (97.8% complete, pdf-parse + OCR) — Phase 1
- Vector embeddings standardized on OpenAI text-embedding-3-small 1536-dim — Phase 1
- Entity extraction to Neo4j (93.5% complete, 88K+ entities, 917K relationships) — Phase 1
- Entity resolution pipeline (Jaro-Winkler dedup, Neo4j merge, PostgreSQL sync) — Phase 1
- Document classification pipeline (content-type via Workers AI) — Phase 1
- Security hardening: credentials redacted, API key defaults removed, .env.example created — Phase 1
- MCP HTTP proxy locked down (nginx IP restriction + requireAuth) — Phase 1
- API key auth fail-closed on missing env var — Phase 1
- Fulltext, semantic, and hybrid search (RRF fusion) — existing
- RAG chat with OpenAI GPT-4o-mini and citation support — existing
- Graph visualization with Cytoscape.js (search, expand, shortest path) — existing
- Entity listing and basic profile pages — existing
- Document viewer with text and PDF rendering — existing
- Cloudflare Tunnel (Zero Trust) ingress — existing
- Prometheus + Grafana monitoring — existing
- Docker Compose orchestration (18 containers) — existing

### Active

**Security & Quality (this milestone):**
- [ ] Fix Cypher injection in graph traversal endpoint (CR-002)
- [ ] Fix ILIKE full table scans on 961K documents (CR-003)
- [ ] Fix fulltext search COUNT query performance (CR-005)
- [ ] Enforce authentication in frontend hooks (CR-006)
- [ ] Sanitize all {@html} renders with DOMPurify (HI-001, HI-002, HI-003)
- [ ] Fix Cypher query blocklist bypass via APOC (HI-004)
- [ ] Remove hardcoded API key in batch-processor.sh (HI-005)
- [ ] Fix MCP server default to public IP without SSL (HI-006)
- [ ] Optimize hybrid search performance (HI-007, HI-008)
- [ ] Fix unbounded chat context growth (HI-009)
- [ ] Parallelize Worker batch processing (HI-010)
- [ ] Extract shared service modules to eliminate duplication (HI-011)
- [ ] Replace raw SQL proxy with proper API endpoints (HI-012)
- [ ] Add CI/CD for Worker and backend (HI-013)
- [ ] Set up vitest + basic CI gate with tests for SQL builders, auth guards, SSE parser (CR-004)

**Phase 2 — Intelligence Layer:**
- [ ] Entity dossier pages: header, documents tab, connections tab, timeline tab, AI bio, analyst notes (E-02 through E-07)
- [ ] AI chat upgrade: configurable Claude model (default Sonnet 4.6) with tool use — search_documents, semantic_search, get_entity_profile, graph_query, find_connections (AI-01 through AI-06)
- [ ] Graph analysis: PageRank centrality, community detection, bridge node detection, hidden connections (G-01 through G-04)
- [ ] Faceted search: content classification filter, entity mention filter, date range presets, saved searches, result export (S-01 through S-05)
- [ ] Timeline visualization: date extraction pipeline, interactive zoomable timeline, entity filtering (T-01 through T-03)
- [ ] Redaction and cross-reference detection (D-02, D-03)
- [ ] Temporal graph filtering (G-05)

### Out of Scope

- Investigation workspace (Phase 3) — depends on Phase 2 features being stable
- Evidence board drag-and-drop (Phase 3) — complex UI, defer until workspace MVP exists
- Report generator (Phase 3) — needs investigation workspace first
- Face detection pipeline (Phase 3) — GPU-intensive, separate infrastructure concern
- Anomaly detection (Phase 3) — needs stable intelligence layer first
- New batch ingestion automation (Phase 3) — current manual process works
- Dashboard landing page (Phase 3) — nice-to-have, not blocking investigations
- Playbook forms in chat UI (AI-07) — P2, tool use is sufficient for now
- Citation verification/hallucination detection (AI-08) — P2, complex to implement well
- More Like This (S-06) — P2, nice-to-have
- Entity-highlighted snippets (S-07) — P2, polish item
- Gap analysis on timeline (T-04) — P2, advanced analysis
- Known event anchors (T-05) — P2, manual data entry needed
- Subgraph export (G-06) — P2, nice-to-have
- Enhanced document viewer with side-by-side PDF (D-04) — P2, significant UI work
- Entity confidence scoring display (E-08) — P2, data quality not sufficient yet
- Mobile app — web-first platform
- Real-time collaboration — solo investigator tool
- Public user registration — single-user behind Cloudflare Access

## Context

**Infrastructure:** Hetzner AX42 (16 cores, ~62GB RAM allocated to Docker), Cloudflare edge (Workers, R2, D1, KV, Pages). Monthly budget ~$100-110 infrastructure + variable API costs.

**Solo developer:** Carl Frank building with Claude Code. No team, no code review process beyond automated checks.

**Phase 1 completed 2026-03-07:** Security hardening, embedding consolidation, entity resolution, document classification all merged to main. Remaining: 20 frontend TS errors, TASK-1.5 (pipeline completion) unverified.

**Code review (2026-03-07):** 38 findings — 7 critical, 13 high, 13 medium, 5 low. CR-001 and CR-007 already fixed. Remaining critical/high findings are the security-first priority for this milestone.

**Existing frontend:** SvelteKit with Svelte 5 runes, Shadcn-svelte (bits-ui + tailwind-variants), feature-sliced design pattern. Routes: /, /search, /chat, /graph, /entities, /entities/[id], /documents/[id].

**Data scale:** 1.47M documents, 1.37M embeddings, 88K entities (post-resolution), 917K relationships.

## Constraints

- **Solo developer**: One person building everything — favor simplicity over architectural elegance
- **Budget**: ~$100-110/mo infrastructure, API costs variable — prefer Workers AI / Haiku for high-volume tasks
- **Server resources**: 62GB RAM already allocated across Docker containers — new services must fit within existing allocation or replace something
- **Cloudflare Pages**: Frontend deployed via adapter-cloudflare, server routes run in Workers runtime (no Node.js APIs)
- **No test infra**: Zero existing tests — foundation-only approach this milestone (vitest + critical path coverage)
- **20 TS errors**: Existing frontend TypeScript errors need resolution before heavy feature work
- **Data sensitivity**: Investigation documents are sensitive — no public endpoints, all access behind Cloudflare Access

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Security fixes before Phase 2 features | Open critical vulnerabilities (Cypher injection, auth bypass, XSS) must be closed before adding more attack surface | -- Pending |
| Claude model configurable in chat | Different investigations benefit from different cost/quality tradeoffs — let user pick | -- Pending |
| Critical + High code review findings only | Medium/Low findings are lower risk, can be addressed incrementally during feature work | -- Pending |
| Foundation-only test infrastructure | Full test coverage would delay features significantly — cover critical paths (SQL, auth, SSE) first | -- Pending |
| Full Phase 2 scope | All 7 PRD sub-tasks — the intelligence layer features are interdependent and collectively transform the platform | -- Pending |
| OpenAI text-embedding-3-small (1536-dim) | Standardized in Phase 1 — all search paths now consistent | Good |
| Workers AI for document classification | High-volume, low-complexity task — cost-effective at scale | Good |
| Cerebras Llama for entity extraction | Fast inference for structured extraction, good JSON compliance with Scout model | Good |

---
*Last updated: 2026-03-07 after initialization*
