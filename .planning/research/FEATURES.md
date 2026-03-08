# Feature Landscape

**Domain:** Investigative intelligence platform (document corpus analysis)
**Researched:** 2026-03-07
**Mode:** Ecosystem research for Phase 2 (Intelligence Layer) milestone

## Table Stakes

Features users expect from any investigative intelligence platform. Missing any of these makes the platform feel like a prototype rather than a tool.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **AI chat with database tool use** | Every investigation platform (Palantir, DataWalk, CrimeTracer, DISCO Cecilia) now has natural-language query over structured data. RAG-only chat is 2023-era. Tool use is the baseline in 2026. | High | Requires Anthropic API integration, tool definitions, execution loop, streaming. Already scoped as AI-01 through AI-06. |
| **Entity dossier/profile pages** | Palantir Gotham, i2 Analyst Notebook, and every OSINT platform (Maltego, Social Links) center on entity profiles. A page that only shows a name and type is not a dossier. Users need documents, connections, timeline, and summary in one view. | Medium | Tabs pattern: header + documents + connections + timeline. Data already exists across PostgreSQL/Neo4j. Primarily frontend assembly work. |
| **Faceted search with filters** | eDiscovery platforms (Relativity, DISCO, Microsoft Purview) all provide content-type filters, date ranges, entity mention filters, and saved searches. Bare keyword search is insufficient for 1.47M documents. | Medium | Content classification filter depends on TASK-1.4 pipeline output. Entity filter depends on populated document_entities table. Date presets are straightforward UI. |
| **Search result export (CSV/JSON)** | Every eDiscovery and investigation platform supports export. Investigators need to take results into reports, spreadsheets, or share with colleagues. Without export, users screenshot or manually copy. | Low | Serialize current result set to CSV/JSON. No new data needed. |
| **Graph visualization with expand/path** | Already exists. This is table stakes for any entity-relationship investigation tool (Maltego, i2, DataWalk all center on link analysis). The current implementation (search, expand neighbors, shortest path) meets the minimum bar. | Already built | Maintain and polish. |
| **Document viewer with text + metadata** | Already exists. Users must be able to read the source document. Every investigation platform provides this. | Already built | Current viewer shows text and PDF. Sufficient for now. |
| **Saved searches** | Microsoft Purview eDiscovery, Relativity, and DISCO all support saving queries with filters for re-execution. Investigators return to the same queries repeatedly as new documents surface. | Low | New saved_searches table, simple CRUD. S-04 in PRD. |

## Differentiators

Features that set this platform apart. Not expected by default, but create significant investigative value when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Graph analysis algorithms (PageRank, communities, bridges)** | Most investigation platforms show graphs but do not run graph algorithms. Palantir Gotham does this, but Maltego and i2 do not natively. Running PageRank to find the most connected entities, Louvain for community detection, and betweenness centrality for bridge nodes transforms a visualization tool into an analytical tool. This is a genuine differentiator for a solo-developer platform. | Medium | Neo4j APOC already enabled. Algorithms are built-in (apoc.algo.pageRank, apoc.algo.louvain). Primary work is API endpoints + UI controls for coloring/sizing nodes. G-01 through G-04. |
| **Hidden connection discovery** | Finding entity pairs that share multiple 2-hop paths but no direct connection is a pattern unique to graph-native investigation. Neither Maltego nor i2 surface this automatically. This is the kind of insight that justifies building on Neo4j. | Medium | Cypher query: find pairs with 2+ shared neighbors but no direct edge. G-04 in PRD. |
| **Interactive zoomable timeline** | i2 Analyst Notebook has timeline views, but most OSINT tools do not. A timeline that lets investigators zoom from decade to day, filtered by entity, creates a temporal narrative that flat document lists cannot. | High | Requires date extraction pipeline first (T-01), then vis-timeline or D3.js frontend. The pipeline is the hard part -- regex + LLM extraction across 1.47M docs. T-01 through T-03. |
| **Redaction detection** | Unique to legal document investigation. Detecting [REDACTED], [SEALED], and blackout patterns, then flagging inconsistent redactions (same content redacted in one doc but visible in another) is a powerful investigative signal. No commercial OSINT tool does this because they do not work with legal document corpora. | Medium | Regex + pattern matching on extracted text. VLM for image-based blackouts if metadata exists. D-02 in PRD. |
| **Cross-reference resolution** | Matching exhibit references and Bates numbers across 1.47M documents creates a document graph that mirrors the legal record's own internal linking. This is eDiscovery-grade functionality. | Medium | Regex extraction of "Exhibit [X]", "Bates No. [XXXX-XXXX]", then fuzzy matching against corpus filenames/metadata. D-03 in PRD. |
| **AI-generated entity biographies** | Using Claude to synthesize what the corpus reveals about an entity, cached on the dossier page, turns hours of manual reading into a 30-second summary. No OSINT platform does this with LLM synthesis over a private corpus. | Low | Single API call per entity with corpus context. Cache in entity metadata. E-06 in PRD. |
| **Temporal graph filtering** | Filtering graph edges by date range to see how relationships evolved over time. Palantir Gotham supports this but almost no other tool does. Requires event dates on relationships. | High | Depends on date extraction pipeline populating relationship timestamps. G-05 in PRD. |
| **Analyst notes on entities** | Investigation notes attached to entity profiles. Turns passive viewing into active analysis. The investigation_notes table already exists but is not wired to the frontend. | Low | CRUD API + UI for existing table. E-07 in PRD. |

## Anti-Features

Features to explicitly NOT build for this milestone. Each has a clear reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Real-time collaboration** | Solo investigator platform behind Cloudflare Access. Building multi-user real-time sync (CRDTs, WebSockets, presence) is massive engineering for zero users. Palantir needs this; a solo-developer tool does not. | Single-user model. Cloudflare Access handles auth. |
| **Public user registration / multi-tenancy** | Sensitive investigation data. No public access. Adding user management, RBAC, data isolation is scope creep that adds attack surface. | Cloudflare Access single-user gate. |
| **Investigation workspace / evidence board** | Phase 3 feature. Drag-and-drop canvas with pinned items, freeform notes, and visual connections is complex UI engineering (svelte-dnd-action, canvas rendering, position persistence). Build this after the intelligence layer is stable. | Defer to Phase 3. Focus Phase 2 on entity dossiers, chat, graph analysis. |
| **Report generator** | Depends on investigation workspace existing first. Without structured evidence collection, a report generator has nothing to compile. | Defer to Phase 3. Export search results covers the immediate need. |
| **Face detection pipeline** | GPU-intensive. InsightFace requires CUDA. The Hetzner AX42 has no GPU. Would need separate infrastructure or cloud GPU API. The face_embeddings Qdrant collection is empty and should stay that way until GPU infra exists. | Defer to Phase 3 when GPU budget/infra is addressed. |
| **Anomaly detection** | Background scheduled analysis (unusual co-occurrences, contradiction detection, network changes) requires a stable intelligence layer to be meaningful. Running anomaly detection before entity resolution, classification, and date extraction are complete produces noise, not signal. | Defer to Phase 3 after intelligence layer data is reliable. |
| **Playbook forms in chat UI** | Structured investigation playbook forms (person_profile, timeline, connection_map) as UI wizards are nice but redundant when Claude has tool use. An investigator can simply type "build me a profile of Jeffrey Epstein" and Claude will use tools to do it. Forms add UI complexity without new capability. | Tool use in chat covers this. AI-07 is correctly P2. |
| **Citation verification / hallucination detection** | Complex to implement well. Requires comparing each AI claim against source documents, which is itself an LLM task. Risk of false positives undermining trust in the system. | Rely on Claude's native citation behavior with tool results. Defer AI-08. |
| **"More Like This" button** | Nice-to-have that is trivially implementable later via Qdrant recommendation API. Not worth prioritizing over core intelligence features. | Defer S-06. |
| **Enhanced document viewer (side-by-side PDF)** | PDF.js integration with synchronized scrolling between original scan and extracted text is significant UI work. Current text viewer is functional. | Defer D-04. |
| **Mobile app** | Web-first platform. Investigation work happens at a desk with multiple monitors, not on a phone. Responsive design is sufficient. | SvelteKit responsive CSS if needed. |
| **Dashboard landing page** | Nice-to-have. The current redirect to /search works. Building a dashboard with pipeline status, alerts, and investigation summaries requires Phase 3 features (anomaly detection, investigations) to have content worth showing. | Defer P-07. Keep / redirecting to /search. |

## Feature Dependencies

```
Entity Resolution (Phase 1, done)
    --> Entity Dossier Pages (documents tab, connections tab)
    --> Entity Mention Filter (faceted search)
    --> AI chat get_entity_profile tool

Document Classification (Phase 1, done)
    --> Content Classification Filter (faceted search)

Date Extraction Pipeline (T-01)
    --> Timeline Visualization (T-02, T-03)
    --> Temporal Graph Filtering (G-05)

AI Chat with Tool Use (AI-01 through AI-06)
    --> AI Entity Biographies (E-06, uses chat API)

Faceted Search Filters (S-01, S-02)
    --> Saved Searches (S-04, saves filter state)
    --> Search Export (S-05, exports filtered results)

Graph Analysis (G-01 through G-03)
    --> Hidden Connection Discovery (G-04, builds on centrality data)

Redaction Detection (D-02) -- independent, no blockers
Cross-Reference Resolution (D-03) -- independent, no blockers
Analyst Notes (E-07) -- independent, uses existing table
```

## MVP Recommendation

**Phase 2 Intelligence Layer -- build in this order:**

1. **AI Chat with Tool Use** (AI-01 through AI-06) -- Highest impact. Transforms the platform from a search tool into an investigative assistant. Every other feature is enhanced by being queryable through chat. Start here because it is the most complex backend work and unblocks AI entity biographies.

2. **Entity Dossier Pages** (E-02 through E-07) -- Second highest visibility. Entity pages go from skeletal to rich. Documents tab, connections tab, timeline tab, AI bio, analyst notes. Data is already in PostgreSQL/Neo4j from Phase 1 entity resolution. Primarily frontend assembly.

3. **Faceted Search** (S-01 through S-05) -- Practical daily-use improvement. Content classification filter, entity mention filter, date presets, saved searches, export. Builds on Phase 1 classification data. Medium complexity, high utility.

4. **Graph Analysis** (G-01 through G-04) -- Analytical differentiator. PageRank, community detection, bridge nodes, hidden connections. APOC algorithms are ready; this is API + UI work. Delivers the "wow factor" of the platform.

5. **Timeline Visualization** (T-01 through T-03) -- Requires date extraction pipeline first, which is the most resource-intensive backend task. Start the extraction pipeline early (can run in background), build the UI after search and graph are done.

6. **Redaction + Cross-Reference Detection** (D-02, D-03) -- Independent of other features. Can be built last. Processing pipelines run in background. Results surface in document viewer and entity dossiers.

**Defer to Phase 3:** Investigation workspace (I-01 through I-05), evidence board, report generator, face detection, anomaly detection, dashboard.

## Complexity Budget

| Feature Group | Estimated Effort | Backend | Frontend | Pipeline |
|---------------|-----------------|---------|----------|----------|
| AI Chat with Tool Use | 5-6 days | Heavy (Anthropic API, tool execution loop, streaming) | Medium (SSE format changes) | None |
| Entity Dossier Pages | 5-6 days | Light (data assembly from existing DBs) | Heavy (5 components, tabs, graph embed) | None |
| Faceted Search | 3-4 days | Medium (filter queries, saved searches CRUD) | Medium (filter UI, export) | None |
| Graph Analysis | 4-5 days | Medium (Cypher algorithm queries, API endpoints) | Medium (node coloring/sizing, controls) | None |
| Timeline | 4-5 days | Light (events API) | Medium (D3/vis-timeline component) | Heavy (date extraction across 1.47M docs) |
| Redaction + Cross-Ref | 4-5 days | Light (storage queries) | Light (display in viewer) | Heavy (regex + LLM processing) |
| **Total** | **26-31 days** | | | |

## Sources

- [Maltego OSINT & Cyber Investigations Platform](https://www.maltego.com/)
- [i2 Analyst's Notebook](https://i2group.com/solutions/i2-analysts-notebook)
- [Palantir Gotham](https://www.palantir.com/platforms/gotham/)
- [DataWalk Investigation Software](https://datawalk.com/solutions/investigation/)
- [DISCO Cecilia AI for Legal Investigation](https://csdisco.com/blog/generative-ai-for-fact-analysis-investigation)
- [Stanford HAI: Trustworthy AI Assistant for Investigative Journalists](https://hai.stanford.edu/news/a-trustworthy-ai-assistant-for-investigative-journalists)
- [CrimeTracer Gen3 Chatbot](https://www.soundthinking.com/blog/advancing-crime-investigation-tools-with-crimetracers-new-chatbot/)
- [Neo4j Graph Algorithms for Community Detection](https://neo4j.com/blog/graph-data-science/graph-algorithms-community-detection-recommendations/)
- [Neo4j Community Detection Docs](https://neo4j.com/docs/graph-data-science/current/algorithms/community/)
- [Microsoft Purview eDiscovery Features](https://learn.microsoft.com/en-us/purview/edisc-features-components)
- [vis-timeline Documentation](https://visjs.github.io/vis-timeline/docs/timeline/)
- [Top 10 OSINT Tools for 2026](https://blog.sociallinks.io/top-10-osint-tools-products-solutions-and-software-for-2026/)
- [OSINT Tools for Security Analysts 2026](https://liferaftlabs.com/blog/osint-tools-for-security-analysts-in-2026)
