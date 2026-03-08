# Domain Pitfalls

**Domain:** Investigative intelligence platform with AI analytics on 961K+ documents
**Researched:** 2026-03-07

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or undermine investigative integrity.

### Pitfall 1: AI Hallucination Presented as Evidence

**What goes wrong:** The Claude chat assistant (TASK-2.2) fabricates connections between entities, invents document references, or synthesizes conclusions not supported by retrieved documents. In an investigative context, hallucinated "evidence" could lead to false accusations or wasted investigation effort. Research shows 30-40% of LLM outputs in reporting contexts contain at least one hallucination, and most errors are not invented entities but rather "unsupported characterizations" -- the model adds context or certainty that the source material does not support.
**Why it happens:** RAG reduces but does not eliminate hallucination. The model may fuse information across multiple retrieved documents in misleading ways, attribute claims to the wrong source, or present speculative connections as established facts. Tool use compounds this -- when Claude calls `graph_query` or `find_connections`, it may over-interpret sparse graph data.
**Consequences:** Investigators act on fabricated leads. Trust in the platform collapses once a hallucination is discovered. In a legal/investigative context, presenting AI-fabricated evidence could have serious ethical and legal consequences.
**Prevention:**
- Every AI claim MUST cite specific document IDs. Display citations inline, not as footnotes.
- Implement faithfulness checking: compare each claim in the AI response against the actual retrieved documents before rendering.
- Add explicit disclaimers on AI-generated content: "AI-generated summary -- verify against source documents."
- For entity dossier AI bios (TASK-2.1), show the source documents alongside the generated text, not in a separate tab.
- Never allow the AI to state conclusions about guilt, innocence, or criminal activity -- restrict to factual summaries of what documents contain.
- Consider confidence scoring on retrieved documents (RE-RAG pattern) so the AI can decline to answer when retrieval quality is low.
**Detection:** Users report "the AI said X but the document says Y." AI responses reference document IDs that don't exist or don't contain the claimed information.
**Phase:** TASK-2.2 (AI Chat Upgrade). Must be addressed in initial implementation, not retrofitted.

### Pitfall 2: Cypher Injection Enables Data Destruction

**What goes wrong:** The existing Cypher injection vulnerability (CR-002) allows an attacker to execute arbitrary Cypher including `DELETE`, `DETACH DELETE`, or APOC procedures through the `/graph/traverse` endpoint. Adding graph analysis features (TASK-2.3) with PageRank, community detection, and hidden connection queries multiplies the attack surface with more endpoints that construct Cypher dynamically.
**Why it happens:** Neo4j does not support parameterization of node labels, relationship types, or property names in standard Cypher. Developers interpolate user input into query strings. The existing blocklist approach (checking for `delete`, `create`, etc.) is fundamentally insufficient because APOC is enabled and provides procedures that bypass keyword blocks. Research confirms that "keyword blocklisting is fundamentally insufficient" for Cypher security.
**Consequences:** An attacker destroys the entire 88K entity / 917K relationship graph. Restoration from backup loses any entity resolution work completed in Phase 1. New graph analysis endpoints become additional injection vectors.
**Prevention:**
- Fix CR-002 BEFORE adding any new graph endpoints (TASK-2.3). This is non-negotiable.
- Create a Neo4j read-only user for ALL query endpoints. The application should never use the `neo4j` admin user for user-facing queries.
- Validate all dynamic Cypher components (labels, relationship types) against strict allowlists of known values.
- For TASK-2.3 graph algorithms: use GDS library procedures with parameterized graph projections, not hand-written Cypher with string interpolation.
- APOC: whitelist only the procedures actually needed; disable the rest via `dbms.security.procedures.allowlist`.
**Detection:** Unexpected empty graph results. Neo4j logs showing `DELETE` or `CALL` operations from the application user. Graph node/relationship counts dropping.
**Phase:** Security milestone (before Phase 2). CR-002 fix is prerequisite.

### Pitfall 3: Stored XSS Through Document Content at Scale

**What goes wrong:** With 961K documents from diverse sources (court filings, emails, scanned documents), some documents inevitably contain HTML-like content or actual HTML. The platform renders document text, search snippets, and AI chat responses using `{@html}` in Svelte without sanitization (HI-001, HI-002, HI-003). Adding entity dossier pages (TASK-2.1), enhanced search results (TASK-2.4), and timeline events (TASK-2.5) creates more rendering surfaces for stored XSS.
**Why it happens:** Svelte's `{@html}` directive bypasses all escaping. PostgreSQL's `ts_headline` wraps matches in `<mark>` tags, requiring raw HTML rendering. Developers add `{@html}` for formatting convenience without considering that document content is untrusted.
**Consequences:** Malicious content in any document executes JavaScript in the investigator's browser. Since this is a single-user tool behind Cloudflare Access, the immediate blast radius is limited, but it could exfiltrate session tokens, modify investigation notes, or corrupt displayed data.
**Prevention:**
- Install DOMPurify and sanitize ALL `{@html}` renders before adding new features. Use `DOMPurify.sanitize(content, { ALLOWED_TAGS: ['mark', 'b', 'em'] })`.
- Create a `sanitizeHtml()` utility in `$lib/utils/` that is the ONLY way to render untrusted HTML. Ban direct `{@html}` of user/document content in code review.
- For new components in TASK-2.1 (EntityDocuments, EntityTimeline) and TASK-2.4 (SearchExport), use text rendering by default. Only use `{@html}` through the sanitize utility.
- Add CSP headers in nginx (`Content-Security-Policy: script-src 'self'`) as defense-in-depth.
**Detection:** `svelte-check` won't catch this. Grep for `{@html` and verify each instance uses sanitization.
**Phase:** Security milestone (before Phase 2). HI-001/002/003 fixes are prerequisites.

### Pitfall 4: Graph Algorithm Memory Exhaustion on 14GB Neo4j

**What goes wrong:** Neo4j GDS (Graph Data Science) library creates an in-memory graph projection for algorithms like PageRank, Louvain community detection, and betweenness centrality. With 88K entities and 917K relationships, the projection alone requires significant memory. The current Neo4j container has 14GB allocated, and GDS Community Edition uses a less memory-efficient implementation than Enterprise. Running a user-triggered PageRank or community detection on the full graph could exhaust available memory and crash the Neo4j container, taking down all graph functionality.
**Why it happens:** GDS algorithms work on in-memory projections, not disk-based data. Community Edition is limited to 4 concurrent algorithm threads and uses more memory per projection than Enterprise. Developers test on small subgraphs and assume production will scale linearly.
**Consequences:** Neo4j OOM crash. All graph queries fail until container restarts. If the crash corrupts the transaction log, data loss is possible. Other services competing for the server's 62GB total RAM may also be affected.
**Prevention:**
- Pre-compute algorithm results during off-peak hours as batch jobs, not on-demand user requests. Store results in PostgreSQL (e.g., `entity_metrics` table with `pagerank`, `community_id`, `betweenness` columns).
- Set memory limits on GDS projections: `gds.graph.project` with `nodeCount` estimation and memory estimation (`gds.pageRank.estimate`) before execution.
- Start with subgraph projections filtered by entity type (e.g., only Person nodes and their relationships) rather than the full graph.
- Monitor Neo4j heap usage via the existing Prometheus/Grafana stack (requires adding Neo4j metrics exporter -- currently missing per ME-013).
- Consider reducing Qdrant from 24GB to 8GB (it only uses ~402MB) and reallocating to Neo4j if needed.
**Detection:** Neo4j container restart in `docker ps`. GDS procedures returning memory errors. Grafana alerts on container memory (once monitoring is set up).
**Phase:** TASK-2.3 (Graph Analysis). Design the batch pre-computation approach before building the UI.

## Moderate Pitfalls

### Pitfall 5: Search Performance Degrades Linearly with Corpus Growth

**What goes wrong:** Three existing endpoints use `ILIKE '%name%'` for person mention searches, forcing full table scans on 961K rows (10-30s per query). The fulltext search runs a redundant COUNT query that doubles latency. Adding faceted search (TASK-2.4) with entity mention filters, date range filters, and classification filters compounds the problem -- each filter adds WHERE clauses that may not be indexable together. GIN indexes cannot be composed with B-tree indexes in a single composite index.
**Why it happens:** Leading-wildcard ILIKE cannot use indexes. PostgreSQL's `COUNT(*)` on complex WHERE clauses must scan matching rows. Developers add filters incrementally without testing combined performance on the full 961K corpus.
**Prevention:**
- Replace ALL ILIKE queries with `search_vector @@ plainto_tsquery()` before adding new search features. This is CR-003 and must be done first.
- Use capped counts: `WITH limited AS (SELECT 1 FROM ... LIMIT 10001) SELECT COUNT(*) FROM limited` -- "10,000+" is sufficient for pagination.
- For entity mention filters in TASK-2.4, query the `document_entities` junction table (populated in Phase 1) with a B-tree index, not ILIKE on document text.
- For date range filters, ensure `document_date` (or `metadata->>'document_date'`) has a B-tree index.
- Pre-compute materialized views for common aggregations (documents per classification, documents per entity).
- Test every new search filter combination against the full corpus BEFORE deploying, with `EXPLAIN ANALYZE`.
**Detection:** Search responses >2 seconds. PostgreSQL slow query log showing sequential scans on `documents` table.
**Phase:** Security milestone (CR-003, CR-005), then TASK-2.4.

### Pitfall 6: Connection Pool Exhaustion Under Concurrent AI + Search Load

**What goes wrong:** The platform currently runs at ~90 PostgreSQL connections against a default limit of 100 (4 backends x 10 + MCP proxy x 20 + fast-processor x 30). Adding Claude tool use (TASK-2.2) means each chat turn could trigger 2-5 tool calls, each requiring a database query. If multiple chat sessions run concurrent tool calls alongside normal search traffic, the pool exhausts and queries start failing with "too many connections" errors.
**Why it happens:** No coordinated pool sizing across services. Each service configures its own pool independently. Claude tool use is bursty -- a single conversation can generate 5+ concurrent database hits.
**Prevention:**
- Audit and cap pool sizes across all services. Total must stay under PostgreSQL's `max_connections` (increase to 200 if needed).
- For Claude tool execution, use a dedicated connection pool with a concurrency limiter (max 3 concurrent tool executions per chat session).
- Add connection pool metrics to Prometheus monitoring.
- Consider PgBouncer as a connection pooler if the problem persists.
**Detection:** "too many connections" errors in any service logs. Slow query performance across all endpoints simultaneously.
**Phase:** Security milestone (ME-006), then TASK-2.2.

### Pitfall 7: Date Extraction Pipeline Produces Low-Quality Timeline Data

**What goes wrong:** The date extraction pipeline (TASK-2.5) uses regex patterns and LLM extraction on 961K documents. Court filings contain multiple dates (filing date, event date, reference dates). Emails have sent dates, mentioned dates, and forwarded dates. Many documents are undated scans. The pipeline extracts dates without context, producing a timeline cluttered with filing dates and procedural dates rather than substantively meaningful events.
**Why it happens:** Regex date extraction has high recall but low precision for "meaningful" dates. LLMs can identify date context ("on March 15, 2005, Epstein traveled to...") but hallucinate when documents are ambiguous. Developers validate on clean test documents and are surprised by the noise in production data.
**Prevention:**
- Extract dates WITH context: store the surrounding sentence, not just the date. The `events` table already has a `description` field -- use it.
- Classify extracted dates by type: `document_date` (when filed/created), `event_date` (when something happened), `reference_date` (date mentioned in passing). Only show `event_date` on timelines by default.
- Set confidence thresholds: regex-extracted dates get lower confidence than LLM-extracted dates with clear context.
- Start with high-confidence dates only (e.g., flight logs with explicit dates, court filings with clear event dates) before attempting general extraction.
- Allow investigators to manually correct or dismiss timeline entries.
**Detection:** Timeline shows clusters of dates that are all filing dates for the same document set. Investigators ignore the timeline because it's too noisy.
**Phase:** TASK-2.5 (Timeline Visualization).

### Pitfall 8: PageRank on Mixed Entity Types Produces Nonsensical Rankings

**What goes wrong:** Running PageRank across the full Neo4j graph ranks Person, Organization, Location, and Event entities together. A frequently-mentioned location like "New York" or an organization like "FBI" may rank higher than persons of actual investigative interest. Community detection groups entities by connectivity patterns that may reflect document co-occurrence rather than real-world relationships.
**Why it happens:** PageRank assumes homogeneous node types. The graph is a document co-occurrence graph, not a social network -- two entities are linked because they appear in the same documents, not because they have a real relationship. This is a fundamental semantic mismatch.
**Prevention:**
- Run algorithms on entity-type-specific subgraph projections: `gds.graph.project('people-graph', 'Person', 'ASSOCIATED_WITH')` rather than the full graph.
- For cross-type analysis, use bipartite projections that project through documents (Person -> Document -> Person).
- Label algorithm results clearly: "Most Connected People (by document co-occurrence)" not "Most Important People."
- Provide entity type filters in the graph analysis UI (TASK-2.3) so investigators can scope analysis to relevant entity types.
- Consider weighted relationships (number of shared documents) rather than binary edges.
**Detection:** Top PageRank results are locations or procedural entities (courts, agencies) rather than persons of interest. Investigators question the algorithm's relevance.
**Phase:** TASK-2.3 (Graph Analysis).

### Pitfall 9: Unbounded Chat Context Costs Spiral with Claude Tool Use

**What goes wrong:** The current chat sends full conversation history on every turn (HI-009). Migrating to Claude with tool use (TASK-2.2) makes this dramatically worse: each tool call round-trip adds both the tool call block and the tool result (which may contain full document text, entity profiles, or graph data) to the context. A 5-turn investigation conversation with 3 tool calls per turn could easily reach 100K+ tokens, costing $3-5 per conversation with Claude Sonnet.
**Why it happens:** Tool results are appended to conversation history by default in the Anthropic API. Developers focus on functionality and don't monitor token usage during development. Testing with short conversations masks the problem.
**Prevention:**
- Truncate tool results before adding to conversation history: summarize long document text to first 500 characters, limit graph results to 20 nodes.
- Implement sliding window context: keep system prompt + last 6 messages + tool results from current turn only.
- Track and display token usage per conversation (Anthropic API returns usage in response headers).
- Set a hard token budget per conversation (e.g., 50K tokens). When approaching the limit, summarize the conversation and start a new context.
- Use Haiku for simple tool calls (search, entity lookup) and Sonnet only for synthesis/analysis turns.
**Detection:** API cost dashboard shows chat costs increasing per conversation. Users report slow responses after extended conversations.
**Phase:** TASK-2.2 (AI Chat Upgrade).

## Minor Pitfalls

### Pitfall 10: Authentication Enforcement Gap Widens with New Endpoints

**What goes wrong:** Currently, authentication relies entirely on Cloudflare Access headers with no server-side enforcement (CR-006). Each new API endpoint added for Phase 2 features (timeline, graph analysis, saved searches, entity dossiers) inherits this gap. The API backend applies auth middleware selectively per-route, meaning new routes added without `requireApiKey` are completely unauthenticated.
**Prevention:** Fix CR-006 and CR-007 before adding any new endpoints. Apply auth middleware globally in the API backend and explicitly exclude only health check endpoints.
**Phase:** Security milestone (CR-006, CR-007).

### Pitfall 11: Neo4j GDS Community Edition Concurrency Limit

**What goes wrong:** GDS Community Edition limits algorithm concurrency to 4 threads. On a 16-core server, algorithms run at 25% potential throughput. If multiple users (or the AI chat) trigger concurrent graph analyses, they queue rather than parallelize.
**Prevention:** Pre-compute results in batch during off-hours. Cache algorithm outputs in PostgreSQL. For the current single-user platform, this is manageable but will become a blocker if the platform ever serves multiple concurrent investigators.
**Phase:** TASK-2.3 (Graph Analysis).

### Pitfall 12: Frontend TypeScript Errors Compound During Feature Development

**What goes wrong:** 20 existing TypeScript errors in the frontend will interact poorly with new feature development. New components may build on broken type foundations, leading to runtime errors that `svelte-check` cannot catch because it already has too many errors to parse cleanly.
**Prevention:** Fix the 20 remaining TS errors before starting TASK-2.1 (Entity Dossier) or any other frontend feature work. Run `svelte-check` in CI and fail on new errors.
**Phase:** Security milestone (before Phase 2 frontend work).

### Pitfall 13: Saved Search Queries Become Invalid After Schema Changes

**What goes wrong:** If saved searches (TASK-2.4) store raw filter parameters and the underlying schema changes (e.g., classification categories renamed, entity types restructured), saved searches break silently or return wrong results.
**Prevention:** Store saved searches as structured query objects with version numbers, not raw SQL or URL parameters. Validate saved search parameters against current schema on load. Show a warning if a saved search references a filter value that no longer exists.
**Phase:** TASK-2.4 (Faceted Search).

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Security milestone (CR-002) | Cypher injection fix incomplete -- blocklist instead of read-only user | Use a dedicated read-only Neo4j user, not keyword filtering |
| Security milestone (CR-006) | Auth enforcement breaks existing frontend routes | Test all routes after adding auth enforcement; ensure Cloudflare Access header propagation works |
| TASK-2.1 Entity Dossier | AI bio generation hallucmates entity connections | Always show source documents alongside AI-generated text |
| TASK-2.2 AI Chat | Token costs spiral with tool use context accumulation | Implement sliding window + tool result truncation from day one |
| TASK-2.2 AI Chat | SSE format change breaks frontend streaming | The Anthropic streaming format differs from OpenAI; rewrite `sse.ts` completely rather than adapting |
| TASK-2.3 Graph Analysis | Memory exhaustion running algorithms on full graph | Pre-compute in batch; estimate memory before execution; start with subgraph projections |
| TASK-2.3 Graph Analysis | PageRank ranks locations above persons | Run algorithms on entity-type-specific subgraphs |
| TASK-2.4 Faceted Search | Combined filters produce slow queries | Test all filter combinations against full corpus with EXPLAIN ANALYZE |
| TASK-2.5 Timeline | Date extraction noise overwhelms signal | Classify dates by type; default to high-confidence event dates only |
| TASK-2.5 Timeline | D3.js bundle size bloats frontend | Use a lightweight timeline library or chart component, not full D3 |
| TASK-2.6 Redaction Detection | False positives on formatting artifacts | Validate redaction patterns against known redacted documents before bulk processing |

## Sources

- [Neo4j Cypher Injection Prevention](https://neo4j.com/developer/kb/protecting-against-cypher-injection/)
- [Neo4j GDS Installation & Compatibility](https://neo4j.com/docs/graph-data-science/current/installation/)
- [Neo4j GDS Defaults and Limits (Community Edition)](https://neo4j.com/docs/graph-data-science/current/production-deployment/defaults-and-limits/)
- [Neo4j GDS PageRank Documentation](https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/)
- [Stanford Legal RAG Hallucinations Study (2025)](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf)
- [RAG Hallucination Causes and Fixes](https://www.mindee.com/blog/rag-hallucinations-explained)
- [Reducing Hallucinations in RAG Systems](https://dasroot.net/posts/2026/03/reduce-hallucinations-in-rag-system/)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [PostgreSQL Full-Text Search Optimization (200M rows case study)](https://medium.com/@yogeshsherawat/using-full-text-search-fts-in-postgresql-for-over-200-million-rows-a-case-study-e0a347df14d0)
- [PostgreSQL FTS Performance Best Practices](https://blog.vectorchord.ai/postgresql-full-text-search-fast-when-done-right-debunking-the-slow-myth)
- [Neo4jection: Cypher Injection Exploitation](https://www.varonis.com/blog/neo4jection-secrets-data-and-cloud-exploits)
- [Cypher Injection Cheat Sheet](https://pentester.land/blog/cypher-injection-cheatsheet/)
- [ISACA: Avoiding AI Pitfalls in 2026](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2025/avoiding-ai-pitfalls-in-2026-lessons-learned-from-top-2025-incidents)

---

*Pitfalls audit: 2026-03-07*
