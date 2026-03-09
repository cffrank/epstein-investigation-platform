# Phase 5: Graph Analysis - Research

**Researched:** 2026-03-09
**Domain:** Neo4j GDS graph algorithms + Cytoscape.js visualization enhancements
**Confidence:** HIGH

## Summary

Phase 5 adds graph algorithm analysis (PageRank, Louvain community detection, betweenness centrality) to the existing Neo4j entity graph (88K entities, 917K relationships) and surfaces results through the existing Cytoscape.js visualization. The core technical challenge is installing Neo4j GDS plugin alongside the existing APOC plugin on the Community Edition Docker image, running batch computations within the 8GB heap constraint, and extending the Cytoscape.js canvas with community coloring, centrality-based sizing, and bridge node highlighting.

Neo4j GDS Community Edition is free and includes all algorithm functionality (PageRank, Louvain, betweenness centrality). The only CE limitation is a concurrency cap of 4 threads, which is irrelevant for batch pre-computation on a single-user platform. The graph size (88K nodes, 917K edges) is well within GDS memory capacity -- a full graph projection should consume approximately 50-100MB of heap, leaving ample headroom in the 8GB heap allocation.

**Primary recommendation:** Install GDS via `NEO4J_PLUGINS: '["apoc","graph-data-science"]'` in docker-compose.yml. Use GDS `write` mode to persist algorithm results as node properties directly in Neo4j. Serve pre-computed results via the existing graph API endpoint. Use Cytoscape.js `underlay-*` properties for bridge node glow effect (shadow properties were removed in Cytoscape.js 3.0).

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Collapsible analysis sidebar on the left side of the graph page (similar to FilterSidebar on search page)
- Sidebar open by default -- investigators see available algorithms immediately
- Graph canvas takes remaining space; existing zoom/fit/reset controls stay in top-right
- Each algorithm has its own accordion section in the sidebar with status indicators
- Algorithms are pre-computed only (batch job) -- sidebar shows cached results instantly
- "Last computed: X ago" timestamp + "Refresh" button to trigger re-computation
- No on-demand GDS execution per request (success criteria #4)
- Each algorithm section shows ranked entity cards: rank number, entity name, type badge, score bar
- Top 10 entities shown by default with "Show more" to expand to top 25
- Clicking an entity in the ranking list highlights it in the graph canvas and expands its neighbors
- Entity name in the card links separately to the dossier page
- Mode toggle in sidebar: "Color by: Type | Community"
- Type mode = current colors (Person=blue, Org=green, Location=orange)
- Community mode = distinct cluster colors (8 max, remainder grouped as gray "Other")
- Node shapes still indicate entity type in both modes
- Compact color legend in bottom-right corner of graph canvas
- Node size = PageRank score (normalized) when available, falls back to connection count
- Top bridge nodes get a subtle glow/halo effect
- Hidden connections: Person-to-Person only, top 20 pairs by shared neighbor count
- Click pair to expand inline showing shared neighbor names; "Load to graph" button loads both + shared neighbors into canvas
- Dashed line between hidden connection pairs; solid lines to shared neighbors
- Selecting an algorithm section auto-loads top 20 ranked entities into the graph canvas

### Claude's Discretion
- GDS plugin installation and configuration on the server
- Batch computation trigger mechanism (API endpoint, script, or admin button)
- Cypher projection queries for GDS algorithm execution
- Cache storage strategy (Neo4j node properties vs PostgreSQL table)
- Glow/halo CSS implementation approach in Cytoscape.js
- Community color palette selection (8 distinct colors)
- Score normalization approach for node sizing
- How to handle GDS memory constraints at 88K nodes / 917K edges

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GRPH-01 | User can run PageRank on the entity graph to identify most connected/influential entities | GDS `gds.pageRank.write()` with results stored as node property `pagerank`. Stream top-N via Cypher `ORDER BY n.pagerank DESC`. |
| GRPH-02 | User can run Louvain community detection to identify entity clusters | GDS `gds.louvain.write()` stores `communityId` on each node. Frontend color-codes by community. Max 8 colors, rest grouped as "Other". |
| GRPH-03 | User can run betweenness centrality to identify bridge nodes between communities | GDS `gds.betweenness.write()` with sampling (~1000 nodes) for performance. Top bridge nodes get underlay glow effect. |
| GRPH-04 | User can discover hidden connections -- entity pairs with shared neighbors but no direct edge | Pure Cypher query on Person nodes: find pairs sharing 3+ neighbors with no direct relationship. Pre-compute and cache in PostgreSQL. |
| GRPH-05 | Graph visualization reflects algorithm results via node size (centrality) and color (community) | Extend GraphCanvas.svelte style functions to read `pagerank`, `communityId`, `betweenness` from node data. Add underlay for bridge nodes. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Neo4j GDS | 2.x (bundled with neo4j:5-community) | Graph algorithms (PageRank, Louvain, betweenness) | Official Neo4j plugin. CE includes all algorithms. Only limitation is 4-thread concurrency cap (irrelevant for batch). |
| Cytoscape.js | ^3.33.1 (already installed) | Graph visualization | Already in use. Extend existing styling functions for centrality sizing, community colors, bridge node underlay. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| APOC | Already installed | Graph utilities | Already present via `NEO4J_PLUGINS: '["apoc"]'`. GDS is additive, not replacing APOC. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Neo4j GDS | APOC algorithms (`apoc.algo.pageRank`) | APOC graph algos are deprecated. GDS is the supported replacement. No reason to use APOC for this. |
| Neo4j GDS | External (NetworkX via Python script) | Requires extracting graph data, running externally, importing results back. Unnecessary complexity when GDS works natively. |
| Storing results in PostgreSQL | Storing as Neo4j node properties | Both viable. Neo4j node properties are simpler -- results live alongside the graph data, no cross-DB joins. PostgreSQL only needed if results must be queried independently of graph context. |

**Installation:**
```yaml
# docker-compose.yml -- Neo4j service change
NEO4J_PLUGINS: '["apoc","graph-data-science"]'
```
No npm packages needed -- all algorithm work happens server-side in Neo4j.

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/lib/features/graph/
  components/
    GraphCanvas.svelte          # MODIFY: add centrality sizing, community colors, bridge underlay
    GraphControls.svelte        # KEEP as-is
    GraphSearch.svelte          # KEEP as-is
    AnalysisSidebar.svelte      # NEW: algorithm sections with ranked entity cards
    AlgorithmSection.svelte     # NEW: accordion section per algorithm
    HiddenConnections.svelte    # NEW: Person-to-Person hidden connection pairs
    GraphLegend.svelte          # NEW: color legend (type or community mode)
  stores.svelte.ts              # MODIFY: add algorithm results state, color mode toggle
frontend/src/routes/
  (app)/graph/+page.svelte      # MODIFY: add sidebar alongside canvas
  api/graph/+server.ts          # MODIFY: add algorithm result query actions
  api/graph/compute/+server.ts  # NEW: trigger batch computation endpoint
```

### Pattern 1: GDS Batch Computation Pipeline
**What:** Project graph into GDS catalog, run algorithms, write results back to node properties, drop projection.
**When to use:** Batch pre-computation triggered by admin action (API endpoint + "Refresh" button in sidebar).
**Example:**
```cypher
// Step 1: Project entity subgraph (Person nodes with all relationships)
CALL gds.graph.project(
  'entity-analysis',
  ['Person', 'Organization', 'Location'],
  {
    ALL: { type: '*', orientation: 'UNDIRECTED' }
  }
)

// Step 2: Run PageRank and write results
CALL gds.pageRank.write('entity-analysis', {
  writeProperty: 'pagerank',
  maxIterations: 20,
  dampingFactor: 0.85
})

// Step 3: Run Louvain and write results
CALL gds.louvain.write('entity-analysis', {
  writeProperty: 'communityId'
})

// Step 4: Run Betweenness Centrality with sampling
CALL gds.betweenness.write('entity-analysis', {
  writeProperty: 'betweenness',
  samplingSize: 1000,
  samplingSeed: 42
})

// Step 5: Drop projection to free memory
CALL gds.graph.drop('entity-analysis')

// Step 6: Store computation timestamp
MERGE (m:Metadata {key: 'algorithm_last_computed'})
SET m.value = datetime()
```
Source: [Neo4j GDS PageRank docs](https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/), [Louvain docs](https://neo4j.com/docs/graph-data-science/current/algorithms/louvain/), [Betweenness docs](https://neo4j.com/docs/graph-data-science/current/algorithms/betweenness-centrality/)

### Pattern 2: Serving Pre-computed Results via API
**What:** Query Neo4j for nodes with algorithm properties, return ranked lists.
**When to use:** Frontend requesting algorithm results for the sidebar.
**Example:**
```cypher
// Top entities by PageRank
MATCH (n)
WHERE n.pagerank IS NOT NULL
RETURN id(n) as id, labels(n)[0] as type, n.name as name,
       n.pagerank as pagerank, n.communityId as communityId,
       n.betweenness as betweenness
ORDER BY n.pagerank DESC
LIMIT 25

// Hidden connections: Person pairs sharing neighbors but no direct edge
MATCH (a:Person)-[]->(shared)<-[]-(b:Person)
WHERE NOT (a)-[]-(b)
  AND id(a) < id(b)
WITH a, b, collect(DISTINCT shared) as sharedNodes, count(DISTINCT shared) as sharedCount
WHERE sharedCount >= 3
RETURN id(a) as personA, a.name as nameA,
       id(b) as personB, b.name as nameB,
       sharedCount,
       [s IN sharedNodes | {id: id(s), name: s.name, type: labels(s)[0]}] as sharedNeighbors
ORDER BY sharedCount DESC
LIMIT 20
```

### Pattern 3: Cytoscape.js Bridge Node Glow via Underlay
**What:** Use `underlay-*` style properties for a glow/halo effect on high-betweenness nodes.
**When to use:** Bridge nodes that connect different communities.
**Example:**
```typescript
// In GraphCanvas.svelte style array, add a selector for bridge nodes:
{
  selector: 'node[?isBridge]',
  style: {
    'underlay-color': '#facc15',  // yellow-400
    'underlay-padding': '8px',
    'underlay-opacity': 0.3,
    'underlay-shape': 'ellipse'
  }
}
```
Source: [Cytoscape.js style docs](https://js.cytoscape.org/#style/overlay-underlay)

### Pattern 4: Community Color Mapping
**What:** Map community IDs to a fixed palette of 8 distinct colors.
**When to use:** When "Color by: Community" mode is active.
**Example:**
```typescript
const COMMUNITY_PALETTE = [
  '#3b82f6', // blue-500
  '#ef4444', // red-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
];

function communityColor(communityId: number | undefined): string {
  if (communityId === undefined || communityId === null) return '#71717a'; // zinc-500
  const topCommunities = getTopCommunities(); // sorted by size, max 8
  const index = topCommunities.indexOf(communityId);
  if (index === -1) return '#71717a'; // "Other" -- gray
  return COMMUNITY_PALETTE[index];
}
```

### Anti-Patterns to Avoid
- **Running GDS on-demand per request:** GDS graph projections are expensive (memory + CPU). Always batch pre-compute.
- **Projecting the full graph for every algorithm:** Create ONE projection, run ALL algorithms, then drop it.
- **Forgetting to drop graph projections:** Memory leak. Always `gds.graph.drop()` after computation.
- **Mixed-type subgraphs without consideration:** Running PageRank on all entity types together is valid for this use case (entities connected by relationships), but hidden connections should be Person-to-Person only per user decision.
- **Using deprecated `gds.graph.create`:** Use `gds.graph.project` (the current syntax).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PageRank algorithm | Custom Cypher iterative PageRank | `gds.pageRank.write()` | Convergence handling, damping factor, numerical stability are all solved. |
| Community detection | Custom label propagation in Cypher | `gds.louvain.write()` | Louvain's hierarchical approach produces better communities than simple label propagation. |
| Betweenness centrality | Manual shortest-path enumeration | `gds.betweenness.write()` with sampling | O(V*E) complexity. GDS uses sampling + degree-proportional selection for efficient approximation. |
| Node glow effect | Custom canvas overlay or HTML overlay div | Cytoscape.js `underlay-*` properties | Built into the rendering pipeline, scales with zoom, works with export. |
| Community color assignment | Random color per community | Fixed palette mapped to top-N communities by size | Consistent colors across sessions. Deterministic. Colorblind-friendly palette. |

**Key insight:** GDS algorithms are mathematically complex with many edge cases around convergence, memory management, and graph topology. The library handles all of this. The only custom code needed is the Cypher queries to project graphs and serve results.

## Common Pitfalls

### Pitfall 1: GDS Graph Projection Memory Leak
**What goes wrong:** Batch computation script creates a graph projection but crashes before `gds.graph.drop()`. The projection persists in memory until Neo4j restarts.
**Why it happens:** Network errors, timeout during long-running betweenness computation, or uncaught exceptions in the batch script.
**How to avoid:** Always check for existing projections before creating new ones: `CALL gds.graph.list() YIELD graphName WHERE graphName = 'entity-analysis' RETURN graphName`. Drop any stale projection first. Wrap the entire computation in a try/catch that drops the projection in the finally block.
**Warning signs:** Neo4j heap usage steadily increasing between batch runs. `gds.graph.list()` shows unexpected projections.

### Pitfall 2: Betweenness Centrality Timeout on Full Graph
**What goes wrong:** Betweenness centrality has O(V*E) complexity. On 88K nodes and 917K edges, a full computation without sampling could take minutes.
**Why it happens:** Default `samplingSize` equals node count (no sampling). Developer tests on small subgraph and doesn't notice.
**How to avoid:** Always set `samplingSize: 1000` (or similar). This uses degree-proportional sampling that focuses on high-degree nodes, producing good approximations. Set `samplingSeed: 42` for reproducible results.
**Warning signs:** Betweenness computation taking more than 30 seconds.

### Pitfall 3: Stale Community Colors After Recomputation
**What goes wrong:** Louvain can assign different community IDs on each run (IDs are non-deterministic). If the frontend maps community IDs to colors, the color assignments shuffle on each recomputation.
**Why it happens:** Louvain's algorithm doesn't guarantee stable community IDs across runs.
**How to avoid:** Map colors by community SIZE (largest community = first color), not by community ID. Sort communities by member count, assign palette colors in order. Store the mapping alongside the computation timestamp so the frontend uses the correct mapping.
**Warning signs:** After clicking "Refresh", all community colors change even though the communities themselves didn't change.

### Pitfall 4: Hidden Connections Query Performance
**What goes wrong:** The hidden connections Cypher query (find Person pairs sharing neighbors but no direct edge) can be slow on dense graphs.
**Why it happens:** The query must check every pair of Person nodes for shared neighbors AND verify no direct edge exists.
**How to avoid:** Pre-compute hidden connections during the batch job, not on-demand. Store results in a PostgreSQL table (personA_id, personB_id, shared_count, shared_neighbor_ids). The Cypher query runs once during batch; the API serves from PostgreSQL.
**Warning signs:** Hidden connections API call taking more than 5 seconds.

### Pitfall 5: Auto-Load Overwhelming the Graph Canvas
**What goes wrong:** Auto-loading top 20 entities with expanded neighbors floods the canvas with 200+ nodes and the layout becomes unreadable.
**Why it happens:** Some top-ranked entities have 50+ connections. Loading 20 entities each with neighbors creates a massive graph.
**How to avoid:** Auto-load the top 20 entities as nodes WITHOUT auto-expanding neighbors. Let the user click to expand individual nodes. This keeps the initial view clean (just 20 nodes in a circle/grid layout).
**Warning signs:** Graph canvas becomes a tangled mess immediately after selecting an algorithm.

## Code Examples

### Batch Computation API Endpoint
```typescript
// frontend/src/routes/api/graph/compute/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { neo4jClient } from '$lib/server/neo4j';

export const POST: RequestHandler = async ({ platform }) => {
  if (!platform) return json({ error: 'Platform not available' }, { status: 500 });
  const client = neo4jClient(platform);

  try {
    // Drop any stale projection
    await client.query(`
      CALL gds.graph.list() YIELD graphName
      WHERE graphName = 'entity-analysis'
      CALL gds.graph.drop(graphName) YIELD graphName AS dropped
      RETURN dropped
    `).catch(() => {}); // ignore if not exists

    // Project all entity types with undirected relationships
    await client.query(`
      CALL gds.graph.project(
        'entity-analysis',
        ['Person', 'Organization', 'Location'],
        { ALL: { type: '*', orientation: 'UNDIRECTED' } }
      )
    `);

    // PageRank
    await client.query(`
      CALL gds.pageRank.write('entity-analysis', {
        writeProperty: 'pagerank',
        maxIterations: 20,
        dampingFactor: 0.85
      })
    `);

    // Louvain
    await client.query(`
      CALL gds.louvain.write('entity-analysis', {
        writeProperty: 'communityId'
      })
    `);

    // Betweenness with sampling
    await client.query(`
      CALL gds.betweenness.write('entity-analysis', {
        writeProperty: 'betweenness',
        samplingSize: 1000,
        samplingSeed: 42
      })
    `);

    // Drop projection
    await client.query(`CALL gds.graph.drop('entity-analysis')`);

    // Store timestamp
    await client.query(`
      MERGE (m:Metadata {key: 'algorithm_last_computed'})
      SET m.value = toString(datetime())
    `);

    return json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    // Attempt cleanup
    await client.query(`CALL gds.graph.drop('entity-analysis')`).catch(() => {});
    return json({ error: error instanceof Error ? error.message : 'Computation failed' }, { status: 500 });
  }
};
```

### GraphCanvas Style Extension for Algorithm Results
```typescript
// In GraphCanvas.svelte, extend the style array:

// Node background color (type vs community mode)
'background-color': (ele: cytoscape.NodeSingular) => {
  const colorMode = ele.data('colorMode'); // passed from parent
  if (colorMode === 'community') {
    return communityColor(ele.data('communityId'));
  }
  // Default type-based coloring
  const type = ele.data('type');
  switch (type) {
    case 'Person': return '#3b82f6';
    case 'Organization': return '#22c55e';
    case 'Location': return '#f97316';
    default: return '#71717a';
  }
},

// Node size based on PageRank when available
width: (ele: cytoscape.NodeSingular) => {
  const pagerank = ele.data('pagerank');
  if (pagerank != null) {
    // Normalize: min 20px, max 60px
    const normalized = Math.max(0, Math.min(1, pagerank / maxPagerank));
    return 20 + normalized * 40;
  }
  const connections = ele.data('connections') || ele.degree();
  return Math.max(20, Math.min(60, 20 + connections * 2));
},
```

### Hidden Connections Cypher Query
```cypher
// Pre-compute during batch -- Person-to-Person pairs sharing neighbors
MATCH (a:Person)-[]->(shared)<-[]-(b:Person)
WHERE NOT (a)-[]-(b)
  AND id(a) < id(b)
WITH a, b, collect(DISTINCT shared) as sharedNodes, count(DISTINCT shared) as cnt
WHERE cnt >= 3
RETURN id(a) as personAId, a.name as personAName,
       id(b) as personBId, b.name as personBName,
       cnt as sharedCount,
       [s IN sharedNodes[0..10] | {id: id(s), name: s.name, type: labels(s)[0]}] as topSharedNeighbors
ORDER BY cnt DESC
LIMIT 20
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `apoc.algo.pageRank` | `gds.pageRank.write()` | APOC algos deprecated since GDS 1.0 (2020) | APOC algos may be removed. Use GDS exclusively. |
| `gds.graph.create()` | `gds.graph.project()` | GDS 2.0 (2022) | Old `create` syntax deprecated. Use `project`. |
| Shadow properties in Cytoscape.js | Underlay properties | Cytoscape.js 3.0 (2017) | `shadow-blur`, `shadow-color` etc. removed. Use `underlay-*` for halo effects. |
| `gds.graph.create.cypher()` | Cypher projection via `gds.graph.project()` with filters | GDS 2.x | Old Cypher projection syntax deprecated. |

**Deprecated/outdated:**
- `apoc.algo.pageRank`, `apoc.algo.community`: Deprecated. GDS is the replacement.
- `gds.graph.create`: Replaced by `gds.graph.project`.
- Cytoscape.js shadow properties: Removed in v3.0. Use `underlay-*` properties instead.

## Open Questions

1. **GDS version compatibility with neo4j:5-community Docker image**
   - What we know: The Docker image supports `NEO4J_PLUGINS: '["graph-data-science"]'` and will auto-download the matching GDS version.
   - What's unclear: Whether the current `neo4j:5-community` tag pulls a version that bundles GDS or downloads separately. Need to verify on the server.
   - Recommendation: Test on server with `docker exec neo4j cypher-shell "RETURN gds.version()"` after updating docker-compose.yml. If plugin fails to load, manually download the GDS jar to the plugins volume.

2. **Exact memory consumption for the full 88K/917K projection**
   - What we know: GDS provides memory estimation via `gds.graph.project.estimate()`. The 8GB heap should be sufficient for this graph size.
   - What's unclear: Exact byte counts. Multiple concurrent projections would multiply memory usage.
   - Recommendation: Run `gds.graph.project.estimate()` first. If tight, consider reducing Neo4j pagecache from 4G to 2G and increasing heap from 8G to 10G. Total 14G container limit.

3. **Hidden connections query performance on full graph**
   - What we know: The Cypher query checking all Person pairs for shared neighbors is computationally expensive.
   - What's unclear: Execution time on 88K nodes. Could be seconds or minutes.
   - Recommendation: Pre-compute during batch, store results. If the Cypher is too slow, compute from GDS projection (find nodes in different communities sharing edges to common nodes).

## Discretion Recommendations

Based on research, here are recommendations for areas left to Claude's discretion:

### Cache Storage: Neo4j Node Properties (Recommended)
Store PageRank, communityId, and betweenness as node properties directly in Neo4j via GDS `write` mode. This is the simplest approach -- no cross-database joins, and the values are available in every Cypher query that returns nodes. Hidden connections (which require aggregation) should be cached in PostgreSQL since they're a computed result not a node property.

### Batch Computation Trigger: API Endpoint + Sidebar Button
Create a `POST /api/graph/compute` endpoint that runs the full GDS pipeline. The sidebar "Refresh" button calls this endpoint. This follows the existing pattern (API endpoints in `frontend/src/routes/api/`). No need for cron or separate scripts.

### Glow/Halo: Cytoscape.js Underlay Properties
Use `underlay-color`, `underlay-padding`, `underlay-opacity`, `underlay-shape` on a `node[?isBridge]` selector. This is the official replacement for removed shadow properties. Set `underlay-padding: 8px`, `underlay-opacity: 0.25`, `underlay-color: '#facc15'` (yellow) for a subtle warm glow.

### Community Color Palette: 8 Tailwind Colors
Use the Tailwind 500-weight palette: blue, red, green, amber, violet, cyan, pink, teal. These are distinct, colorblind-accessible in pairs, and consistent with the existing design system. Map by community SIZE (largest = first color) for stability across recomputations.

### Score Normalization: MinMax to [0, 1]
Normalize PageRank scores for node sizing using MinMax: `(score - min) / (max - min)`. Then map to pixel range [20, 60]. This is straightforward and produces visually useful differentiation. GDS provides a `scaler: 'MinMax'` parameter that can do this automatically during `write`.

### Memory Strategy: Run and Monitor
The graph (88K nodes, 917K edges) is small by GDS standards. Project all entity types together (Person + Organization + Location) with undirected relationships. Run memory estimation before first production use. If heap pressure is observed, reduce pagecache from 4G to 2G (page cache is for disk-based queries, less important during GDS batch runs).

## Sources

### Primary (HIGH confidence)
- [Neo4j GDS Docker Installation](https://neo4j.com/docs/graph-data-science/current/installation/installation-docker/) -- Plugin installation via NEO4J_PLUGINS env var
- [Neo4j GDS PageRank](https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/) -- write mode syntax, parameters, scaler option
- [Neo4j GDS Louvain](https://neo4j.com/docs/graph-data-science/current/algorithms/louvain/) -- community detection, write mode, intermediate communities
- [Neo4j GDS Betweenness Centrality](https://neo4j.com/docs/graph-data-science/current/algorithms/betweenness-centrality/) -- sampling parameters, degree-proportional selection
- [Neo4j GDS System Requirements](https://neo4j.com/docs/graph-data-science/current/installation/System-requirements/) -- CE concurrency cap at 4, heap recommendations
- [Neo4j GDS Memory Estimation](https://neo4j.com/docs/graph-data-science/current/common-usage/memory-estimation/) -- estimate procedure syntax
- [Cytoscape.js shadow removal (Issue #1758)](https://github.com/cytoscape/cytoscape.js/issues/1758) -- shadow properties removed in v3.0
- [Cytoscape.js underlay PR #2928](https://github.com/cytoscape/cytoscape.js/pull/2928) -- underlay-* property support

### Secondary (MEDIUM confidence)
- [Neo4j GDS Native Projection](https://neo4j.com/docs/graph-data-science/current/management-ops/graph-creation/graph-project/) -- gds.graph.project syntax
- [Neo4j GDS Introduction](https://neo4j.com/docs/graph-data-science/current/introduction/) -- CE vs EE: all algorithms available in CE

### Tertiary (LOW confidence)
- [Neo4j GitHub Issue #13563](https://github.com/neo4j/neo4j/issues/13563) -- GDS compatibility issues with specific Neo4j 5.26 version (may affect pinned versions)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - GDS CE is well-documented, free, includes all needed algorithms
- Architecture: HIGH - Batch pre-computation pattern is standard GDS usage; Cytoscape.js underlay properties are documented
- Pitfalls: HIGH - Memory concerns, projection leaks, and community ID instability are well-known GDS issues documented in official guides
- Hidden connections query: MEDIUM - Performance on 88K nodes untested; may need optimization

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- GDS and Cytoscape.js are mature libraries)
