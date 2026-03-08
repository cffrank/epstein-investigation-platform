# Technology Stack -- Phase 2 Intelligence Layer

**Project:** Epstein Investigation Platform
**Researched:** 2026-03-07
**Scope:** New libraries and tools needed for Phase 2 features only (existing stack documented in `.planning/codebase/STACK.md`)

## Recommended Stack

### AI Chat -- Claude with Tool Use

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@anthropic-ai/sdk` | ^0.78.0 | Claude API client with streaming + tool use | Official Anthropic TypeScript SDK. Supports Cloudflare Workers runtime natively. Tool use is GA (no beta header). Streaming via `client.messages.stream()` handles SSE automatically. The existing chat code uses raw `fetch()` to OpenAI -- the Anthropic SDK is more ergonomic for tool use loops (auto-handles tool_result round-trips). | HIGH |

**Do NOT use:**
- `@ai-sdk/anthropic` (Vercel AI SDK provider) -- Adds unnecessary abstraction layer. The project already has a working SSE parser (`sse.ts`) and Svelte 5 stores. Vercel AI SDK's React-oriented hooks add no value in SvelteKit and its streaming abstractions conflict with the existing TransformStream pattern.
- `openai` npm package for chat -- Keep for embeddings only. Claude is strictly better for tool use (native support, not bolted on).
- `@anthropic-ai/claude-agent-sdk` -- Overkill. This is for building autonomous agents, not a chat endpoint with tools.

**Implementation notes:**
- The Anthropic SDK works in Cloudflare Pages server routes (Workers runtime). Use `new Anthropic({ apiKey, fetch: globalThis.fetch })` if needed for edge compatibility.
- Route Anthropic calls through the existing Cloudflare AI Gateway (`internal-gateway`) for monitoring, caching, and rate limiting. Set `baseURL` to `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`.
- The existing SSE parser (`frontend/src/lib/features/chat/sse.ts`) needs minor updates: add `tool_use` and `tool_result` event types alongside existing `delta`, `citations`, `done`.
- Tool execution happens server-side in the SvelteKit API route. The tool loop is: call Claude -> if tool_use blocks returned -> execute tools against DBs -> send tool_results back -> repeat until text response.
- Model selection: Default to `claude-sonnet-4-20250514` (cost-effective, good tool use). Allow user override to `claude-opus-4-20250514` for complex investigations.

### Timeline Visualization

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `d3-scale` | ^4.0.2 | Time scales for axis | D3 modular packages for the math/scales only. Svelte handles DOM rendering. This is the standard approach for Svelte + D3 (Rich Harris pattern). LayerCake adds unnecessary abstraction for a single chart type. | HIGH |
| `d3-time` | ^3.1.0 | Time interval calculations | Provides `timeYear`, `timeMonth`, `timeDay` for zoom level transitions. | HIGH |
| `d3-axis` | ^3.0.0 | Axis generation helpers | Generates tick marks and labels for the time axis. | HIGH |
| `d3-brush` | ^3.0.0 | Zoom/pan interaction | Enables range selection for timeline zoom. Combined with Svelte transitions for smooth zooming between decade/year/month/day. | HIGH |
| `d3-time-format` | ^4.1.0 | Date formatting | Format tick labels ("Jan 2005", "Q3 2008", etc.) at different zoom levels. | HIGH |

**Do NOT use:**
- `vis-timeline` -- Full timeline widget with its own DOM management. Conflicts with Svelte's reactivity model. Heavy bundle (200KB+). Hard to customize styling to match Shadcn-svelte design system.
- `LayerCake` -- Good library, wrong use case. LayerCake shines for multi-chart dashboards. For a single custom timeline, D3 scales + Svelte components is simpler and more customizable.
- `chart.js` / `svelte-chartjs` -- Canvas-based, not SVG. Limits interactivity (can't click individual events, no hover tooltips with rich content). Timeline is an interactive investigative tool, not a static chart.

**Implementation notes:**
- Build as a Svelte 5 component (`TimelineView.svelte`) using SVG elements driven by D3 scales.
- Use `$state` for zoom level (decade/year/month/day) and visible range. `$derived` for the D3 scale based on current range.
- Events rendered as SVG circles/rects positioned by `d3.scaleTime()`. Click handlers link to source documents.
- Entity filter as a Shadcn-svelte multi-select dropdown above the timeline.
- Aggregate view: bar chart of event counts per time bucket at high zoom levels, individual events at day-level zoom.

### Graph Analysis Algorithms

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Neo4j GDS (Graph Data Science) plugin | 2.x (Community) | PageRank, Louvain community detection, betweenness centrality | GDS Community Edition is free and includes ALL algorithms (PageRank, Louvain, betweenness centrality, node similarity). Limited to 4 CPU cores, which is fine for 88K entities. APOC's graph algorithms are deprecated in favor of GDS. The project currently only has APOC installed -- GDS must be added. | HIGH |

**Do NOT use:**
- APOC graph algorithms (`apoc.algo.pageRank`, etc.) -- Deprecated since Neo4j 4.x. GDS is the replacement. APOC page rank is less accurate and lacks community detection entirely.
- Client-side graph algorithms in JavaScript -- The graph has 88K nodes and 917K edges. Running PageRank in the browser is not feasible. Neo4j GDS runs natively on the graph and returns results in seconds.
- NetworkX (Python) -- Would require exporting the graph, processing externally, and importing results. GDS operates directly on the Neo4j graph with zero data movement.

**Installation (Docker Compose change):**
```yaml
neo4j:
  image: neo4j:5-community
  environment:
    NEO4J_PLUGINS: '["apoc", "graph-data-science"]'
```

**Implementation notes:**
- GDS requires creating an in-memory graph projection first: `CALL gds.graph.project('investigation', '*', '*')`. This loads the graph into memory for algorithm execution.
- PageRank: `CALL gds.pageRank.stream('investigation') YIELD nodeId, score RETURN gds.util.asNode(nodeId).name AS name, score ORDER BY score DESC LIMIT 50`
- Louvain: `CALL gds.louvain.stream('investigation') YIELD nodeId, communityId RETURN gds.util.asNode(nodeId).name AS name, communityId`
- Betweenness: `CALL gds.betweenness.stream('investigation') YIELD nodeId, score RETURN gds.util.asNode(nodeId).name AS name, score ORDER BY score DESC LIMIT 50`
- Hidden connections (no GDS needed): Pure Cypher query finding 2-hop paths between entities with no direct connection.
- Graph projection should be rebuilt when new entities/relationships are added. Cache results in PostgreSQL or Redis to avoid re-computation on every page load.
- Neo4j 5 Community with GDS Community limits to 4 cores. For 88K nodes / 917K edges, algorithms should complete in under 10 seconds. If not, pre-compute and cache.

### Graph Visualization Enhancements

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `cytoscape` (existing) | ^3.33.1 | Graph rendering with community coloring and PageRank sizing | Already installed. Cytoscape supports dynamic styling via `ele.style()`. Community colors map to `background-color`, PageRank scores map to `width`/`height`. No new library needed. | HIGH |

**Implementation notes:**
- Community detection results: Map `communityId` to a color palette (12-16 distinct colors). Apply via Cytoscape `style` selector: `node[community = 1] { background-color: #e74c3c }`.
- PageRank results: Normalize scores to a 20-80px range. Apply via `mapData` in Cytoscape styles: `'width': 'mapData(pagerank, 0, 1, 20, 80)'`.
- Bridge nodes: Highlight with a distinct border style (dashed, contrasting color) using `border-style: dashed` and `border-color`.
- Add a "Run Analysis" dropdown to `GraphControls.svelte` with options: PageRank, Communities, Bridges. Results cached in the graph store.

### Faceted Search

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Shadcn-svelte components (existing) | ^2.15.5 | Filter UI components | Use existing `Select`, `DatePicker` (via `@internationalized/date`), `Popover`, `Button` from Shadcn-svelte. No new UI library needed. | HIGH |
| `file-saver` | ^2.0.5 | CSV/JSON export | Trigger browser downloads for exported search results. Lightweight (2KB). | MEDIUM |

**Do NOT use:**
- `papaparse` for CSV -- Overkill for generating CSV. Simple `Array.map().join()` is sufficient for flat search result rows. PapaParse is for *parsing* complex CSVs, not generating them.
- Elasticsearch/MeiliSearch -- The existing PostgreSQL full-text search + Qdrant hybrid search handles the query patterns. Adding a search engine for facets would duplicate data and add operational complexity on a resource-constrained server.

**Implementation notes:**
- Content classification filter: `Select` component populated from `SELECT DISTINCT metadata->>'content_classification' FROM documents WHERE metadata->>'content_classification' IS NOT NULL`.
- Entity mention filter: `Combobox` (cmdk-sv) searching PostgreSQL `entities` table. Selected entity adds `WHERE id IN (SELECT document_id FROM document_entities WHERE entity_id = $1)` to the search query.
- Date range: Use existing `@internationalized/date` + `DatePicker` from bits-ui. Presets as a separate `Select` that sets the date range.
- Saved searches: New `saved_searches` PostgreSQL table. CRUD via SvelteKit API route. Dropdown in search sidebar.
- Export: Generate CSV/JSON client-side from the current search results array. Use `file-saver` for the download trigger, or `URL.createObjectURL` + `<a download>` (no library needed).

### Entity Dossier Pages

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Shadcn-svelte `Tabs` (existing) | ^2.15.5 | Tab navigation for dossier sections | Overview, Documents, Connections, Timeline tabs. Already available in the component library. | HIGH |
| `cytoscape` (existing) | ^3.33.1 | Mini graph for Connections tab | Embed a smaller Cytoscape instance showing only direct connections. Reuse existing `GraphCanvas` component with constrained data. | HIGH |

**Implementation notes:**
- No new dependencies needed for entity dossiers. This is primarily a data fetching + UI composition task.
- Data sources: PostgreSQL `entities` + `document_entities` for documents tab, Neo4j neighbor query for connections tab, aggregated event dates for timeline tab.
- AI biography: Call the new Claude chat API endpoint with a system prompt like "Summarize what is known about [entity] from the following documents" and cache the result in `entities.metadata->>'ai_biography'`.
- Performance: For entities with 1000+ document mentions, paginate the documents tab (25 per page). Pre-compute mention counts and cache in the `entities` table.

### Testing (Foundation)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `vitest` | ^3.1.0 | Unit testing | Specified in ROADMAP.md. Works with Vite (already used). Zero-config for TypeScript. Needed for testing SQL builders, auth guards, SSE parser, tool execution logic. | HIGH |
| `@testing-library/svelte` | ^5.2.0 | Component testing | Test dossier tabs, filter sidebar, export functionality. Works with Vitest. | MEDIUM |

**Do NOT use:**
- Jest -- Vitest is drop-in compatible and faster. Already uses Vite for builds.
- Playwright (yet) -- E2E tests are Phase 3 territory. Unit tests for critical paths first.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| AI SDK | `@anthropic-ai/sdk` (direct) | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) | Adds React-oriented abstraction. Tool use loop is clearer with direct SDK. Project already has SSE handling. |
| Timeline | D3 modular + Svelte | `vis-timeline` | Heavy, own DOM management, conflicts with Svelte reactivity. Cannot match Shadcn-svelte styling. |
| Timeline | D3 modular + Svelte | `LayerCake` | Good for dashboards, overkill for one timeline. Direct D3 scales are simpler. |
| Graph algos | Neo4j GDS plugin | APOC algorithms | APOC algos deprecated. GDS is more accurate, better maintained, has Louvain. |
| Graph algos | Neo4j GDS plugin | igraph/NetworkX (Python) | Requires data export. GDS runs in-place on Neo4j graph. |
| Graph viz | Cytoscape.js (existing) | Sigma.js, vis-network | Already installed and working. Supports all needed styling. Switching gains nothing. |
| CSV export | `file-saver` or native | PapaParse | PapaParse is for *parsing*, not generating. Native approach works fine. |
| Search engine | PostgreSQL FTS + Qdrant (existing) | Elasticsearch / MeiliSearch | Duplicates data. RAM-constrained server (62GB already allocated). Existing search works. |

## Installation

```bash
# In frontend/ directory
cd frontend

# Core new dependency
npm install @anthropic-ai/sdk

# D3 modules for timeline (tree-shakeable, only what we need)
npm install d3-scale d3-time d3-axis d3-brush d3-time-format

# D3 types for TypeScript
npm install -D @types/d3-scale @types/d3-time @types/d3-axis @types/d3-brush @types/d3-time-format

# Testing foundation
npm install -D vitest @testing-library/svelte

# Optional: file export helper
npm install file-saver
npm install -D @types/file-saver
```

```bash
# Server-side: Add GDS plugin to Neo4j (docker-compose.yml change only)
# Update NEO4J_PLUGINS from '["apoc"]' to '["apoc", "graph-data-science"]'
# Then restart: ssh root@88.99.61.233 'cd /opt/app && docker compose up -d neo4j'
```

**No Python dependencies needed for Phase 2 frontend features.** The date extraction pipeline (`processing/date-extractor/`) will need its own `requirements.txt` but that's a processing container concern, not a frontend stack decision.

## Dependency Impact Summary

| New Dependency | Bundle Impact | Runtime | Risk |
|----------------|--------------|---------|------|
| `@anthropic-ai/sdk` | ~50KB (server-side only, not bundled to client) | Cloudflare Workers | LOW -- official SDK, well-maintained |
| `d3-scale` + `d3-time` + `d3-axis` + `d3-brush` + `d3-time-format` | ~35KB total (tree-shakeable) | Client | LOW -- D3 is the standard, stable APIs |
| `vitest` | Dev only | Dev | LOW -- Vite-native test runner |
| Neo4j GDS plugin | ~200MB in container | Server | MEDIUM -- increases Neo4j memory usage. May need to increase from 14GB allocation. Monitor heap usage after enabling. |
| `file-saver` | ~2KB | Client | LOW -- simple utility |

## Configuration Changes Required

### Environment Variables (new)
```bash
# Already exists in /opt/app/.env, needs to be bound in SvelteKit
ANTHROPIC_API_KEY=  # Already available, needs wrangler secret binding for Pages

# Optional: AI Gateway routing
CLOUDFLARE_AI_GATEWAY_ID=  # For routing Anthropic calls through CF AI Gateway
```

### Docker Compose Changes
```yaml
# docker-compose.yml -- neo4j service
NEO4J_PLUGINS: '["apoc", "graph-data-science"]'

# May need to increase Neo4j memory for GDS graph projections
NEO4J_server_memory_heap_initial__size: 4G   # currently likely 512m default
NEO4J_server_memory_heap_max__size: 8G       # GDS projects load graph into heap
```

### Cloudflare Pages Environment
```bash
# Add to wrangler.toml or Cloudflare dashboard for Pages
wrangler pages secret put ANTHROPIC_API_KEY
```

## Sources

- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- v0.78.0, last published 16 days ago
- [Anthropic TypeScript SDK GitHub](https://github.com/anthropics/anthropic-sdk-typescript) -- Cloudflare Workers listed as supported runtime
- [Anthropic Streaming Messages API](https://docs.anthropic.com/en/api/messages-streaming) -- SSE format documentation
- [Neo4j GDS Installation (Docker)](https://neo4j.com/docs/graph-data-science/current/installation/installation-docker/) -- Plugin install via NEO4J_PLUGINS env var
- [Neo4j GDS Algorithms](https://neo4j.com/docs/graph-data-science/current/algorithms/) -- Full algorithm catalog (Community Edition includes all)
- [Neo4j GDS Louvain](https://neo4j.com/docs/graph-data-science/current/algorithms/louvain/) -- Community detection algorithm
- [D3-scale npm](https://www.npmjs.com/package/d3-scale) -- v4.0.2, stable
- [Cytoscape.js](https://js.cytoscape.org/) -- v3.33.1, style mapping documentation
- [LayerCake](https://layercake.graphics/) -- Evaluated but not recommended for this use case
- [vis-timeline GitHub](https://github.com/visjs/vis-timeline) -- Evaluated but not recommended
- [Svelte + D3 patterns (Vis Society 2026)](https://vis-society.github.io/lectures/intro-svelte-d3.html) -- Current best practices
- [Cloudflare AI Gateway + Anthropic](https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/) -- Routing config

---

*Stack research: 2026-03-07*
