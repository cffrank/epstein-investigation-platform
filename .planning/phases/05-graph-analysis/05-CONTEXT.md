# Phase 5: Graph Analysis - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Run graph algorithms (PageRank, Louvain community detection, betweenness centrality) on the Neo4j entity graph to surface influential entities, communities, bridge nodes, and hidden connections. Results are pre-computed in batch and served from cache. The existing Cytoscape.js graph visualization is enhanced to reflect algorithm results via node sizing, coloring, and bridge node highlighting.

Requirements: GRPH-01 through GRPH-05.

</domain>

<decisions>
## Implementation Decisions

### Algorithm Controls UX
- Collapsible analysis sidebar on the left side of the graph page (similar to FilterSidebar on search page)
- Sidebar open by default -- investigators see available algorithms immediately
- Graph canvas takes remaining space; existing zoom/fit/reset controls stay in top-right
- Each algorithm has its own accordion section in the sidebar with status indicators
- Algorithms are pre-computed only (batch job) -- sidebar shows cached results instantly
- "Last computed: X ago" timestamp + "Refresh" button to trigger re-computation
- No on-demand GDS execution per request (success criteria #4)

### Algorithm Results Display
- Each algorithm section shows ranked entity cards: rank number, entity name, type badge, score bar
- Top 10 entities shown by default with "Show more" to expand to top 25
- Clicking an entity in the ranking list highlights it in the graph canvas and expands its neighbors
- Entity name in the card links separately to the dossier page (doesn't navigate away from graph)

### Color Scheme
- Mode toggle in sidebar: "Color by: Type | Community"
- Type mode = current colors (Person=blue, Org=green, Location=orange)
- Community mode = distinct cluster colors (8 max, remainder grouped as gray "Other")
- Node shapes still indicate entity type in both modes (Person=ellipse, Org=diamond, Location=triangle)
- Compact color legend in bottom-right corner of graph canvas, updates when mode toggles

### Node Sizing
- When centrality scores are available, node size = PageRank score (normalized)
- Replaces current connection-count-based sizing
- Falls back to connection count if no centrality data computed

### Bridge Node Visualization
- Top bridge nodes (high betweenness centrality) get a subtle glow/halo effect in the graph canvas
- Makes bridge nodes visually pop, especially when community colors are active -- spot the connectors between clusters

### Hidden Connections (GRPH-04)
- Person-to-Person only -- most investigatively valuable
- Top 20 pairs ranked by shared neighbor count shown in sidebar section
- Click pair to expand inline showing shared neighbor names
- Second click (or "Load to graph" button) loads both entities + shared neighbors into canvas
- Dashed line shown between the pair in the graph to indicate suggested/indirect connection
- Solid lines to shared neighbors (actual documented relationships)

### Auto-Load Behavior
- Selecting an algorithm section (e.g., PageRank) auto-loads top 20 ranked entities into the graph canvas
- Quick discovery workflow: click algorithm -> see top entities -> click entity -> expand neighbors

### Claude's Discretion
- GDS plugin installation and configuration on the server
- Batch computation trigger mechanism (API endpoint, script, or admin button)
- Cypher projection queries for GDS algorithm execution
- Cache storage strategy (Neo4j node properties vs PostgreSQL table)
- Glow/halo CSS implementation approach in Cytoscape.js
- Community color palette selection (8 distinct colors)
- Score normalization approach for node sizing
- How to handle GDS memory constraints at 88K nodes / 917K edges

</decisions>

<specifics>
## Specific Ideas

- Bridge nodes with glow effect + community colors create a powerful visual: you immediately see which entities connect different clusters
- Hidden connections are the investigative gold -- two people sharing 5+ associates but never documented together is a significant finding
- Analysis sidebar mirrors the FilterSidebar pattern from search page -- consistent UX across the platform
- "Last computed" timestamp gives investigators confidence in data freshness
- Auto-loading top entities into canvas when selecting an algorithm removes friction from discovery workflow

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/lib/features/graph/components/GraphCanvas.svelte`: Cytoscape.js canvas with dynamic node sizing and type-based colors -- extend with centrality sizing + community colors
- `frontend/src/lib/features/graph/components/GraphControls.svelte`: Zoom/fit/reset controls -- stays as-is in top-right
- `frontend/src/lib/features/graph/components/GraphSearch.svelte`: Graph search bar -- stays as-is
- `frontend/src/lib/features/graph/stores.svelte.ts`: Graph state management -- extend with algorithm results state
- `frontend/src/routes/api/graph/+server.ts`: Graph API with search, neighbors, path actions -- extend with algorithm result endpoints
- `frontend/src/lib/server/neo4j.ts`: Neo4j client -- reuse for GDS algorithm queries
- `frontend/src/lib/features/filters/components/FilterSidebar.svelte`: Accordion sidebar pattern -- reference for analysis sidebar structure
- `frontend/src/lib/utils/index.ts`: entityColor() utility -- extend or complement for community colors

### Established Patterns
- Cytoscape.js dynamic styling via functions (node size, color, shape based on data properties)
- Svelte 5 runes for reactive graph state ($state, $derived)
- Feature-sliced directory: frontend/src/lib/features/graph/ -- add analysis components here
- Graph API uses action-based POST endpoint (search, neighbors, path) -- add algorithm actions
- Node data properties: id, label, type, connections -- extend with pagerank, community, betweenness

### Integration Points
- `frontend/src/routes/(app)/graph/+page.svelte` -- add analysis sidebar alongside existing canvas
- `frontend/src/lib/features/graph/stores.svelte.ts` -- add algorithm results state, color mode toggle
- `frontend/src/lib/features/graph/components/GraphCanvas.svelte` -- update styling functions for centrality sizing, community colors, bridge glow
- `frontend/src/routes/api/graph/+server.ts` -- add actions: pagerank, communities, bridges, hidden-connections
- New: batch computation script/endpoint for running GDS algorithms and caching results
- New: `frontend/src/lib/features/graph/components/AnalysisSidebar.svelte`
- New: `frontend/src/lib/features/graph/components/GraphLegend.svelte`

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 05-graph-analysis*
*Context gathered: 2026-03-09*
