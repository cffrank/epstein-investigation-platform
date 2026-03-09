# Phase 4: Faceted Search and Export - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Add entity mention filtering, saved searches, and result export to the existing search page. Content classification filters (SRCH-01) and date range filters (SRCH-03) already exist in the FilterSidebar -- this phase adds entity filtering (SRCH-02), saved searches (SRCH-04), and export (SRCH-05). Also populate the currently-empty entities array on search results.

Requirements: SRCH-01 through SRCH-05.

</domain>

<decisions>
## Implementation Decisions

### Entity Mention Filtering (SRCH-02)
- Type-ahead autocomplete in filter sidebar: text input searches entities as user types (debounced)
- Shows top 10 matching entities with colored type badges (Person blue, Organization purple, Location green)
- Click to add entity as filter chip below the input
- Multiple entities supported with AND logic -- results must mention ALL selected entities
- Filter chips show entity name + colored type badge + remove button
- Entity data comes from existing entity search API (Neo4j)

### Entity Badges on Search Results
- Each search result card shows entity badges for entities mentioned in that document
- Populate the currently-empty entities array from document_entities table
- Show first 3 entity badges + "+N more" overflow
- Entity badges use existing entityColor() convention

### Saved Searches (SRCH-04)
- Stored in localStorage (solo investigator -- no cross-device sync needed)
- Saves: query, mode, all active filters (entities, classification, date range, source, doc_type), name, timestamp
- "Save search" button near results header with inline name prompt
- Auto-suggests name based on query text
- Saved searches list in filter sidebar (bottom section, accordion)
- Click saved search name to load and execute
- Delete via X button on each saved search
- Active saved search shows banner with filter summary + Clear button

### Export (SRCH-05)
- Export ALL matching results (not just visible page), up to reasonable server limit
- Two format options: CSV and JSON
- Download button near results header (next to Save search button)
- Fields included: filename, source, doc_type, date, score, snippet, entities
- Server-side generation to handle large result sets

### Claude's Discretion
- Exact export result limit (e.g., 1000 or 5000 max)
- How to handle export for very large result sets (streaming vs batch)
- Whether existing hardcoded filter options should be made dynamic (query actual data for available values)
- How to integrate entity filtering into the three search modes (fulltext, semantic, hybrid)
- CSV delimiter and encoding choices
- Debounce timing for entity autocomplete

</decisions>

<specifics>
## Specific Ideas

- Filter sidebar already has 4 accordion sections (Source, Doc Type, Classification, Date Range) -- add Entity Mentions as a 5th section and Saved Searches as a 6th
- Entity autocomplete should feel like the cmdk-sv command palette already in the project
- Export button and Save button should be a compact action bar near "N results for X"
- SRCH-01 and SRCH-03 are essentially already done -- the existing FilterSidebar has content classification (12 types) and date range (start/end date inputs)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/lib/features/filters/components/FilterSidebar.svelte`: Existing filter sidebar with 4 sections -- extend with entity + saved searches
- `frontend/src/lib/features/search/stores.svelte.ts`: Search store with filters state -- extend with entity filters + saved search management
- `frontend/src/lib/features/search/components/SearchResults.svelte`: Result cards -- add entity badges
- `frontend/src/routes/api/search/+server.ts`: Search API -- add entity filtering to SQL queries
- `frontend/src/routes/api/entities/+server.ts`: Entity search API -- reuse for autocomplete
- `frontend/src/lib/utils/index.ts`: entityColor() utility for badge colors
- `frontend/src/lib/types/index.ts`: SearchResult, SearchFilters types -- extend
- `config/postgres/init/01-schema.sql`: document_entities table exists with document_id + entity_id

### Established Patterns
- Accordion sections in FilterSidebar for filter groups
- URL state sync for search params (query, mode, page)
- Svelte 5 runes for search store state
- Debounced search input (300ms in entity listing page)
- Capped COUNT queries for performance

### Integration Points
- `frontend/src/lib/features/filters/components/FilterSidebar.svelte` -- add 2 new accordion sections
- `frontend/src/routes/api/search/+server.ts` -- add entity filter WHERE clauses + populate entities array
- `frontend/src/lib/features/search/stores.svelte.ts` -- add savedSearches state + entity filter state
- `frontend/src/lib/types/index.ts` -- extend SearchFilters with entities, extend SearchResult.entities
- New API route: `frontend/src/routes/api/search/export/+server.ts` for export generation

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 04-faceted-search-and-export*
*Context gathered: 2026-03-08*
