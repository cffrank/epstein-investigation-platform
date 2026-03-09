# Phase 3: Entity Dossier Pages - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Comprehensive entity profile pages with documents, connections, timeline, AI-generated biography, and analyst notes in a single tabbed interface. An investigator can view everything known about an entity in one place. Entity listing page and basic detail page already exist -- this phase enriches them into full dossiers.

Requirements: ENTY-01 through ENTY-06.

</domain>

<decisions>
## Implementation Decisions

### Tab Organization
- 5 tabs: Documents, Connections, Timeline, Biography, Notes
- Merge current Overview tab (co-occurrences) into Connections tab -- eliminates redundancy
- Default tab: Documents (most useful starting point for investigators)
- Tab labels show counts: "Documents (234)", "Connections (47)", "Notes (3)"
- Documents tab includes inline search bar + document type filter dropdown (ENTY-02 requires search/filter)

### AI Biography Generation
- On-demand generation: user clicks "Generate Biography" button, bio streams in real-time
- Agentic approach: Claude calls search_documents, get_entity_profile, etc. during generation (same tool loop as chat)
- Show tool call panels during generation (reuse collapsible panel pattern from Phase 2 chat)
- Default model: Sonnet 4.6 for bio generation
- Results cached in PostgreSQL entities.description field
- Show generation date + "Regenerate" button for cached bios
- Biography includes tool-based citations with superscript badges (same pattern as chat)
- Citation panel below bio shows source documents with similarity scores
- AI disclaimer footer on biography (same context-aware pattern as chat)

### Analyst Notes UX
- Inline editing within Notes tab -- no modal dialogs
- "Add Note" button at top of notes list
- Each note shows: timestamp, content text, Edit and Delete action buttons
- Plain text only -- no markdown formatting (notes are quick observations, not documents)
- No categorization or tagging -- simple chronological list (newest first)
- Delete requires inline confirmation dialog ("Are you sure? [Delete] [Cancel]")
- Notes persist in PostgreSQL investigation_notes table

### Entity Header Design
- Header shows: entity name (large), type badge (colored), aliases, document count, connection count
- Aliases displayed inline comma-separated below name: "AKA: G. Maxwell, Ghislaine M., Ms. Maxwell"
- If more than 4 aliases, show first 3 + "+N more" expandable
- Type badge uses existing entityColor() CSS variables: Person (blue), Organization (purple), Location (green)
- Document and connection counts as "234 documents · 47 connections" summary line
- "Ask Claude about entity" button in header -- opens chat page pre-filled with entity name

### Claude's Discretion
- Exact system prompt for biography generation (tone, structure, length)
- How to structure the bio generation API endpoint (SSE streaming route)
- Timeline tab data aggregation approach (how to extract/group events chronologically)
- Connections tab layout for merged direct relationships + co-occurrences
- How to handle entities with zero documents or zero connections
- Pagination strategy for Documents tab with 200+ results
- investigation_notes table schema (may need creation or migration)
- Bio caching invalidation strategy (when to suggest regeneration)

</decisions>

<specifics>
## Specific Ideas

- Tool panels during bio generation should feel identical to chat tool panels (consistent UX)
- "Ask Claude about entity" bridges the dossier to conversational investigation -- pre-fill chat with entity name
- Notes are intentionally simple -- investigators want fast capture, not a note-taking app
- Document count in tab label gives immediate sense of how well-documented an entity is
- Bio citations make the AI synthesis trustworthy -- every claim traceable to source documents
- Existing entity detail page already has Documents, Connections, Overview tabs -- refactor, don't rebuild from scratch

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/routes/(app)/entities/[id]/+page.svelte`: Existing entity detail page with 3 tabs -- refactor into 5-tab dossier
- `frontend/src/routes/(app)/entities/[id]/+page.server.ts`: Server-side data loading (Neo4j + PostgreSQL) -- extend with timeline + notes data
- `frontend/src/lib/server/anthropic.ts`: Anthropic client via AI Gateway -- reuse for bio generation
- `frontend/src/lib/server/tools/`: 5 investigation tools -- reuse for agentic bio generation
- `frontend/src/lib/features/chat/components/ToolCallPanel.svelte`: Collapsible tool panels -- reuse in bio generation UI
- `frontend/src/lib/features/chat/components/ChatMessage.svelte`: Citation rendering logic -- extract and reuse for bio citations
- `frontend/src/lib/features/entities/components/EntityHoverCard.svelte`: Entity hover card -- reuse in connections tab
- `frontend/src/lib/utils/index.ts`: entityColor(), truncate(), formatFileSize() utilities
- `frontend/src/lib/server/db.ts`: PostgreSQL query helper -- reuse for notes CRUD and bio caching
- `frontend/src/lib/server/neo4j.ts`: Neo4j query helper -- reuse for connections and timeline data
- `frontend/src/lib/types/index.ts`: Entity, EntityConnection, EntityCoOccurrence, EntityProfile types -- extend

### Established Patterns
- SvelteKit +page.server.ts for server-side data loading -- extend for dossier data
- Svelte 5 runes ($state, $derived) for reactive tab state
- Feature-sliced directory: frontend/src/lib/features/entities/ -- add dossier components here
- shadcn-svelte Tabs component (bits-ui) -- use for 5-tab layout
- SSE streaming with TransformStream -- reuse for bio generation streaming
- Tool-based citations with [doc:UUID] format -- reuse for bio citations
- DOMPurify sanitization for AI-generated content

### Integration Points
- `frontend/src/routes/(app)/entities/[id]/+page.svelte` -- major refactor target (3 tabs -> 5 tabs)
- `frontend/src/routes/(app)/entities/[id]/+page.server.ts` -- extend data loading
- New API route needed: `frontend/src/routes/api/entities/[id]/biography/+server.ts` -- SSE bio generation
- New API route needed: `frontend/src/routes/api/entities/[id]/notes/+server.ts` -- notes CRUD
- `config/postgres/init/01-schema.sql` -- investigation_notes table may need migration
- `frontend/src/lib/types/index.ts` -- add InvestigationNote, EntityBiography types
- `frontend/src/routes/(app)/chat/+page.svelte` -- accept pre-filled entity query param

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 03-entity-dossier-pages*
*Context gathered: 2026-03-08*
