# Phase 4: Faceted Search and Export - Research

**Researched:** 2026-03-08
**Domain:** Search filtering, localStorage persistence, server-side CSV/JSON export
**Confidence:** HIGH

## Summary

Phase 4 extends the existing search page with entity mention filtering, saved searches (localStorage), and result export (CSV/JSON). The codebase already has a working FilterSidebar with 4 accordion sections, a search store using Svelte 5 runes, and a search API with parameterized SQL builders for fulltext, semantic, and hybrid modes. The `document_entities` join table exists in PostgreSQL but the search API currently returns `entities: []` for every result -- populating this is the core data plumbing task.

Entity autocomplete can reuse the existing `/api/entities` endpoint (Neo4j search) with debouncing. Saved searches are pure client-side (localStorage). Export requires a new server-side endpoint that runs the same search queries but with higher limits and streams CSV or JSON output. The existing `command` (cmdk-sv) UI component is available for autocomplete UX.

**Primary recommendation:** Extend existing search infrastructure incrementally -- add entity filtering SQL joins, populate entity arrays in results, add two new FilterSidebar accordion sections, and create one new export API route.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Entity mention filter: type-ahead autocomplete, debounced, top 10 results with colored type badges
- Multiple entity filter uses AND logic (results must mention ALL selected entities)
- Entity data source: existing Neo4j entity search API
- Entity badges on search results: first 3 + "+N more" overflow
- Populate currently-empty entities array from document_entities table
- Saved searches stored in localStorage (no cross-device sync)
- Saves: query, mode, all active filters, name, timestamp
- "Save search" button near results header with inline name prompt
- Saved searches list in filter sidebar (bottom section, accordion)
- Export ALL matching results (not just visible page), server-side generation
- Two formats: CSV and JSON
- Export fields: filename, source, doc_type, date, score, snippet, entities
- Filter chips show entity name + colored type badge + remove button

### Claude's Discretion
- Exact export result limit (e.g., 1000 or 5000 max)
- How to handle export for very large result sets (streaming vs batch)
- Whether existing hardcoded filter options should be made dynamic
- How to integrate entity filtering into the three search modes
- CSV delimiter and encoding choices
- Debounce timing for entity autocomplete

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | Filter by document content classification | Already implemented in FilterSidebar (12 classifications). Verify SQL WHERE clause works correctly with `metadata->>'content_classification'`. |
| SRCH-02 | Filter by entity mentions | New: add entity autocomplete in sidebar, add SQL JOIN on `document_entities` table, populate `entities[]` on results |
| SRCH-03 | Filter by date range (presets + custom) | Partially implemented (custom date inputs exist). Add year/decade presets. SQL WHERE on `created_at` already works. |
| SRCH-04 | Save search with filters, re-execute later | New: localStorage persistence, save/load/delete UI in sidebar accordion |
| SRCH-05 | Export results to CSV or JSON | New: server-side export endpoint, download trigger in UI |

</phase_requirements>

## Standard Stack

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.x | App framework | Already the project framework |
| Svelte 5 | 5.x (runes) | UI reactivity | Already in use, `$state`, `$derived` |
| shadcn-svelte | - | UI components | Already provides Accordion, Badge, Button, Card, Command, Input, Tabs |
| @lucide/svelte | - | Icons | Already in use for Search, FileText, X icons |
| PostgreSQL | 16 | Document store | 961K documents, `document_entities` join table |
| Neo4j | v5 | Entity graph | Entity search for autocomplete |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cmdk-sv (via shadcn `command`) | - | Autocomplete/combobox | Entity type-ahead search |
| @epstein/shared | - | Validation | `validateSearchQuery`, `validatePaginationParams` |
| DOMPurify | - | HTML sanitization | Already used for search snippets |

### No New Dependencies Needed
This phase requires zero new npm packages. Everything is already in the project.

## Architecture Patterns

### Existing Search Flow (Extend, Don't Replace)
```
SearchPage (URL state sync)
  -> FilterSidebar (accordion sections, emits filter object)
  -> SearchStore (Svelte 5 runes class, holds query/filters/results)
  -> /api/search POST (server-side SQL builder)
  -> PostgreSQL (fulltext) + Qdrant (semantic) + hybrid (RRF merge)
  -> SearchResults (card rendering)
```

### New Components/Files
```
frontend/src/
├── lib/
│   ├── features/
│   │   ├── filters/
│   │   │   └── components/
│   │   │       └── FilterSidebar.svelte       # EXTEND: add Entity + Saved Searches sections
│   │   └── search/
│   │       ├── stores.svelte.ts               # EXTEND: add entity filters, saved searches
│   │       └── components/
│   │           ├── SearchResults.svelte        # EXTEND: add entity badges
│   │           ├── EntityAutocomplete.svelte   # NEW: debounced entity search input
│   │           ├── SavedSearches.svelte        # NEW: saved search list + management
│   │           └── ExportButton.svelte         # NEW: export dropdown (CSV/JSON)
│   └── types/
│       └── index.ts                           # EXTEND: SearchFilters, SavedSearch type
├── routes/
│   ├── (app)/search/+page.svelte              # EXTEND: wire new filter props, action bar
│   └── api/search/
│       ├── +server.ts                         # EXTEND: entity filter SQL, populate entities[]
│       └── export/+server.ts                  # NEW: export endpoint
```

### Pattern: Entity Filtering in SQL

For fulltext and hybrid searches, add a subquery join on `document_entities`:

```sql
-- When entity_ids filter is provided, add this to WHERE clause:
AND d.id IN (
  SELECT de.document_id
  FROM document_entities de
  WHERE de.entity_id = ANY($N)
  GROUP BY de.document_id
  HAVING COUNT(DISTINCT de.entity_id) = $M  -- M = number of selected entities (AND logic)
)
```

For semantic search, apply entity filtering as a post-filter on Qdrant results (filter the PostgreSQL lookup after getting doc IDs from Qdrant).

### Pattern: Populating Entity Badges on Results

After getting search result doc IDs, batch-fetch entities:

```sql
SELECT de.document_id, e.id, e.canonical_name as name, e.entity_type as type
FROM document_entities de
JOIN entities e ON e.id = de.entity_id
WHERE de.document_id = ANY($1)
ORDER BY de.mention_count DESC
```

Group by document_id in application code, attach top entities to each SearchResult.

### Pattern: Saved Searches (localStorage)

```typescript
interface SavedSearch {
  id: string;          // crypto.randomUUID()
  name: string;
  query: string;
  mode: SearchMode;
  filters: SearchFilters;
  createdAt: string;   // ISO timestamp
}

// localStorage key: 'epstein-saved-searches'
// Store as JSON array
```

### Pattern: Export Endpoint

```typescript
// POST /api/search/export
// Body: { query, filters, mode, format: 'csv' | 'json' }
// Response: streamed file download with Content-Disposition header
```

### Anti-Patterns to Avoid
- **Don't fetch entities per-result in a loop:** Batch-fetch all entities for all result doc IDs in one query, then merge in-memory.
- **Don't use client-side export for large results:** The user decided server-side generation. Client would choke on 5000+ results.
- **Don't duplicate SQL builder logic for export:** Reuse the same `fulltextSearch`/`semanticSearch`/`hybridSearch` functions with a higher limit parameter.
- **Don't store saved searches in a database:** User explicitly chose localStorage for solo investigator use case.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Autocomplete UI | Custom dropdown | shadcn `Command` component (cmdk-sv) | Keyboard navigation, accessibility, focus management |
| UUID generation | Custom ID scheme | `crypto.randomUUID()` | Browser-native, unique enough for localStorage |
| CSV generation | Custom string concatenation | Proper CSV escaping function | Commas in filenames, quotes in snippets break naive CSV |
| Debounce | Custom setTimeout logic | Simple debounce utility (already 300ms pattern in codebase) | Race conditions, cleanup |
| Date presets | Manual date math | Simple preset map (year ranges, decade ranges) | Edge cases with months, leap years |

## Common Pitfalls

### Pitfall 1: Missing Index on document_entities
**What goes wrong:** Entity filter JOIN scans the entire `document_entities` table (could be millions of rows).
**Why it happens:** The schema creates the table but no indexes beyond the UNIQUE constraint on `(document_id, entity_id)`.
**How to avoid:** The UNIQUE constraint on `(document_id, entity_id)` creates an implicit index, but for lookups by `entity_id` alone (which is the filter direction), add: `CREATE INDEX idx_document_entities_entity_id ON document_entities(entity_id)`.
**Warning signs:** Entity-filtered searches are significantly slower than unfiltered.

### Pitfall 2: Entity Color Mismatch
**What goes wrong:** CONTEXT.md says "Person blue, Organization purple, Location green" but actual CSS variables are Person=#3b82f6 (blue), Org=#22c55e (green), Location=#f97316 (orange).
**How to avoid:** Use the existing `entityColor()` utility and CSS custom properties. Don't hardcode new colors that conflict.
**Warning signs:** Entity badges show different colors than entity pages.

### Pitfall 3: Export Timeout on Large Result Sets
**What goes wrong:** Exporting 5000 results requires running the full search query with LIMIT 5000, which can timeout.
**Why it happens:** Fulltext search with complex filters on 961K docs + entity JOIN is expensive.
**How to avoid:** Cap export at 5000 results. For fulltext, the capped COUNT already limits to 10001. Use the same search functions but with higher limit. Set a generous server timeout (30s).
**Warning signs:** Export button hangs, user gets no feedback.

### Pitfall 4: Semantic Search Export Limitation
**What goes wrong:** Semantic search via Qdrant returns limited results (Qdrant `limit` parameter). Requesting 5000 from Qdrant may be slow or unsupported.
**How to avoid:** For semantic search export, cap at a lower limit (e.g., 1000) or document the limitation. Qdrant scroll API could help but adds complexity.
**Warning signs:** Semantic export silently returns fewer results than expected.

### Pitfall 5: localStorage Quota
**What goes wrong:** Storing many saved searches with full filter state fills localStorage (typically 5-10MB limit).
**How to avoid:** Each saved search is ~500 bytes. Even 1000 searches would be ~500KB. Not a real concern, but add a max saved searches limit (e.g., 100) as a safety valve.
**Warning signs:** `QuotaExceededError` in console.

### Pitfall 6: CSV Special Characters
**What goes wrong:** Filenames and snippets contain commas, quotes, newlines that break CSV.
**How to avoid:** Proper CSV escaping: wrap fields in double quotes, escape internal quotes by doubling them. Use BOM for Excel UTF-8 compatibility.
**Warning signs:** CSV opens garbled in Excel.

### Pitfall 7: FilterSidebar Props Growing Unwieldy
**What goes wrong:** FilterSidebar already takes 4 props + callback. Adding entities + saved searches makes it 6+ props.
**How to avoid:** Consider passing the search store directly, or group related props into a single filters object. The current pattern of individual props is starting to strain.
**Warning signs:** Prop drilling 8+ values through.

## Code Examples

### Entity Filter SQL (Fulltext Search Extension)
```typescript
// Add to fulltextSearch() after existing filter conditions:
if (filters.entityIds?.length) {
  conditions.push(`id IN (
    SELECT de.document_id FROM document_entities de
    WHERE de.entity_id = ANY($${paramIndex})
    GROUP BY de.document_id
    HAVING COUNT(DISTINCT de.entity_id) = ${filters.entityIds.length}
  )`);
  params.push(filters.entityIds);
  paramIndex++;
}
```

### Batch Entity Fetch for Results
```typescript
// After getting search results, populate entities:
if (results.length > 0) {
  const docIds = results.map(r => r.id);
  const entityRows = await dbQuery<{
    document_id: string;
    id: string;
    name: string;
    type: string;
  }>(platform, `
    SELECT de.document_id, e.id, e.canonical_name as name, e.entity_type as type
    FROM document_entities de
    JOIN entities e ON e.id = de.entity_id
    WHERE de.document_id = ANY($1)
    ORDER BY de.mention_count DESC
  `, [docIds]);

  // Group by document
  const entityMap = new Map<string, EntityRef[]>();
  for (const row of entityRows) {
    const list = entityMap.get(row.document_id) || [];
    list.push({ id: row.id, name: row.name, type: row.type as EntityType });
    entityMap.set(row.document_id, list);
  }

  // Attach to results
  for (const result of results) {
    result.entities = entityMap.get(result.id) || [];
  }
}
```

### CSV Export with Proper Escaping
```typescript
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function resultsToCsv(results: SearchResult[]): string {
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel
  const header = 'filename,source,doc_type,date,score,snippet,entities';
  const rows = results.map(r => [
    escapeCsvField(r.filename),
    escapeCsvField(r.source),
    escapeCsvField(r.doc_type || ''),
    escapeCsvField(r.date || ''),
    r.score.toFixed(4),
    escapeCsvField(r.snippet.replace(/<[^>]*>/g, '')), // Strip HTML
    escapeCsvField(r.entities.map(e => e.name).join('; '))
  ].join(','));

  return BOM + header + '\n' + rows.join('\n');
}
```

### Saved Search localStorage
```typescript
const STORAGE_KEY = 'epstein-saved-searches';
const MAX_SAVED = 100;

function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedSearch(search: SavedSearch): void {
  const searches = loadSavedSearches();
  searches.unshift(search); // newest first
  if (searches.length > MAX_SAVED) searches.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
}

function deleteSavedSearch(id: string): void {
  const searches = loadSavedSearches().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
}
```

## Discretion Recommendations

### Export Result Limit: 5000
Rationale: The capped COUNT already stops at 10001. With 20 results per page, 5000 covers 250 pages -- more than an investigator would manually review. Keeps query time under 30 seconds. For semantic mode, cap at 1000 (Qdrant limitation).

### Export Strategy: Single Batch (Not Streaming)
Rationale: At 5000 results, the JSON/CSV payload is ~2-5MB. This fits comfortably in memory and avoids streaming complexity. Use a single query, build the response, return as a blob download. Set response timeout to 60s.

### Keep Hardcoded Filter Options (For Now)
Rationale: The existing classification/source/docType lists are accurate and fast. Making them dynamic requires COUNT queries on 961K rows per filter load. Defer dynamic filters to a future enhancement. The hardcoded lists match actual data.

### Entity Filtering Integration by Search Mode
- **Fulltext:** Add SQL subquery JOIN in WHERE clause (most efficient, uses PostgreSQL indexes)
- **Semantic:** Post-filter after Qdrant results. Fetch 3x the limit from Qdrant, filter by entity in PostgreSQL, return top N. This is less precise for pagination but acceptable.
- **Hybrid:** Both fulltext and semantic legs apply entity filtering independently before RRF merge.

### CSV: Standard Comma Delimiter, UTF-8 with BOM
Rationale: Comma is universal. BOM ensures Excel auto-detects UTF-8. No reason to deviate.

### Debounce: 300ms for Entity Autocomplete
Rationale: Matches the existing 300ms debounce pattern used in entity listing page. Fast enough to feel responsive, slow enough to avoid hammering Neo4j.

## Database Considerations

### Required Index
```sql
-- Add index for entity_id lookups (filter direction)
CREATE INDEX CONCURRENTLY idx_document_entities_entity_id
ON document_entities(entity_id);
```
The existing UNIQUE(document_id, entity_id) handles lookups by document_id (for populating entity badges), but lookups by entity_id (for filtering) need a dedicated index.

### document_entities Data Volume
Unknown -- need to check how many rows exist in production. If the entity extraction pipeline has run on 67K+ documents with 88K entities, this table could have millions of rows. The index above is critical.

### entities Table Structure
- `id` is UUID (PostgreSQL)
- `canonical_name` is the display name
- `entity_type` is lowercase ('person', 'organization', 'location') -- note this differs from the TypeScript EntityType which uses PascalCase ('Person', 'Organization', 'Location'). The mapping happens in application code.

**Important:** The entity search API (`/api/entities`) queries Neo4j using `id(n)` (Neo4j internal IDs), NOT the PostgreSQL `entities.id` UUID. The `document_entities` table references PostgreSQL `entities.id`. Entity filtering must use PostgreSQL entity IDs, NOT Neo4j IDs. The autocomplete should return PostgreSQL UUIDs, which means either:
1. Query PostgreSQL `entities` table directly for autocomplete (simpler, avoids ID mismatch), or
2. Query Neo4j but cross-reference with PostgreSQL to get UUIDs

**Recommendation:** Use PostgreSQL `entities` table for autocomplete. It has `canonical_name` with a name index. This avoids the Neo4j-to-PostgreSQL ID mapping problem entirely.

```sql
-- Entity autocomplete query
SELECT id, canonical_name as name, entity_type as type
FROM entities
WHERE canonical_name ILIKE $1 || '%'
ORDER BY canonical_name
LIMIT 10
```

Add trigram index for performant ILIKE:
```sql
CREATE INDEX CONCURRENTLY idx_entities_name_trgm
ON entities USING GIN(canonical_name gin_trgm_ops);
```

## Open Questions

1. **document_entities data volume**
   - What we know: Schema exists, entity extraction pipeline has processed ~67K docs
   - What's unclear: How many rows are in `document_entities` in production
   - Recommendation: Check row count on server before implementing. If empty, entity filtering will return no results -- that's fine, it's forward-compatible.

2. **Entity type casing (PostgreSQL vs Neo4j)**
   - What we know: PostgreSQL `entities.entity_type` stores lowercase ('person'), TypeScript uses PascalCase ('Person'), Neo4j uses PascalCase labels
   - What's unclear: Whether all entities in PostgreSQL `entities` table match Neo4j entities
   - Recommendation: Normalize in the autocomplete query (use `initcap(entity_type)` or map in application code)

3. **Semantic search export feasibility at 1000 results**
   - What we know: Qdrant search typically returns top-N with cosine similarity
   - What's unclear: Qdrant performance at limit=1000+ with payload filtering
   - Recommendation: Test and fallback to 500 if slow. Document limitation in UI.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `frontend/src/routes/api/search/+server.ts` -- existing search SQL builders
- Codebase analysis: `frontend/src/lib/features/filters/components/FilterSidebar.svelte` -- existing filter UI
- Codebase analysis: `config/postgres/init/01-schema.sql` -- document_entities schema
- Codebase analysis: `frontend/src/lib/features/search/stores.svelte.ts` -- search store pattern
- Codebase analysis: `frontend/src/routes/api/entities/+server.ts` -- entity search API (Neo4j)
- Codebase analysis: `frontend/src/lib/types/index.ts` -- SearchResult, EntityRef types
- Codebase analysis: `frontend/src/lib/utils/index.ts` -- entityColor() utility
- Codebase analysis: `frontend/src/app.css` -- entity color CSS custom properties

### Secondary (MEDIUM confidence)
- PostgreSQL documentation: GIN trigram indexes for ILIKE performance
- CSV RFC 4180: Standard CSV escaping rules

### Tertiary (LOW confidence)
- Qdrant performance at high limit values (needs production testing)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, no new dependencies
- Architecture: HIGH -- extending existing patterns with well-understood SQL JOINs
- Pitfalls: HIGH -- identified from direct codebase analysis (missing indexes, ID mapping, color mismatch)
- Entity ID mapping: MEDIUM -- PostgreSQL vs Neo4j ID systems need careful handling

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable domain, existing codebase)
