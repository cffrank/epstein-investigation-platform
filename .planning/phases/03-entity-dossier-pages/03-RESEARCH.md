# Phase 3: Entity Dossier Pages - Research

**Researched:** 2026-03-08
**Domain:** SvelteKit entity profile pages with tabbed UI, SSE streaming AI biography, PostgreSQL CRUD
**Confidence:** HIGH

## Summary

Phase 3 enriches the existing entity detail page (3 tabs: Overview, Documents, Connections) into a 5-tab dossier (Documents, Connections, Timeline, Biography, Notes). The existing codebase provides strong foundations: shadcn-svelte Tabs component, Neo4j + PostgreSQL data loading patterns, Anthropic SDK with SSE streaming, and tool call UI panels from Phase 2's chat feature.

The main new capabilities are: (1) an SSE streaming biography endpoint that reuses the chat API's tool loop pattern, (2) a notes CRUD API backed by PostgreSQL `investigation_notes` table, and (3) a timeline tab aggregating entity-related events. All patterns exist in the codebase already -- this phase is primarily composition and extension, not greenfield.

**Primary recommendation:** Refactor the existing `[id]/+page.svelte` from 3 tabs to 5 tabs, reuse Phase 2 streaming/tool/citation patterns for biography, and add simple REST endpoints for notes CRUD.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 5 tabs: Documents, Connections, Timeline, Biography, Notes
- Merge current Overview tab (co-occurrences) into Connections tab
- Default tab: Documents
- Tab labels show counts: "Documents (234)", "Connections (47)", "Notes (3)"
- Documents tab includes inline search bar + document type filter dropdown (ENTY-02)
- On-demand biography generation: user clicks "Generate Biography" button, bio streams in real-time
- Agentic approach for bio: Claude calls search_documents, get_entity_profile, etc. during generation
- Show tool call panels during generation (reuse collapsible panel pattern from Phase 2 chat)
- Default model: Sonnet 4.6 for bio generation
- Results cached in PostgreSQL entities.description field
- Show generation date + "Regenerate" button for cached bios
- Biography includes tool-based citations with superscript badges (same pattern as chat)
- Citation panel below bio shows source documents with similarity scores
- AI disclaimer footer on biography
- Inline editing within Notes tab -- no modal dialogs
- "Add Note" button at top of notes list
- Each note shows: timestamp, content text, Edit and Delete action buttons
- Plain text only -- no markdown formatting
- No categorization or tagging -- simple chronological list (newest first)
- Delete requires inline confirmation dialog ("Are you sure? [Delete] [Cancel]")
- Notes persist in PostgreSQL investigation_notes table
- Header shows: entity name (large), type badge (colored), aliases, document count, connection count
- Aliases displayed inline comma-separated below name with "+N more" expandable for >4
- Type badge uses existing entityColor() CSS variables
- "Ask Claude about entity" button in header -- opens chat page pre-filled with entity name

### Claude's Discretion
- Exact system prompt for biography generation (tone, structure, length)
- How to structure the bio generation API endpoint (SSE streaming route)
- Timeline tab data aggregation approach
- Connections tab layout for merged direct relationships + co-occurrences
- How to handle entities with zero documents or zero connections
- Pagination strategy for Documents tab with 200+ results
- investigation_notes table schema (may need creation or migration)
- Bio caching invalidation strategy

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENTY-01 | Entity page displays header with name, type, aliases, document count, connection count | Extend existing header in +page.svelte; aliases from Neo4j e.aliases property; counts from existing data |
| ENTY-02 | Documents tab with search/filter | Refactor existing Documents tab; add Input for search, select/dropdown for doc_type filter; filter client-side or server-side |
| ENTY-03 | Connections tab with Neo4j neighbors, relationship types, weights | Merge existing Connections + Overview tabs; group by relationship type (existing pattern) with co-occurrences |
| ENTY-04 | Timeline tab with entity-related events in chronological order | Query Neo4j for event nodes connected to entity; fallback to document dates if no events exist |
| ENTY-05 | AI biography via Claude with cached results | New SSE endpoint reusing chat API tool loop; cache in entities.description; stream with ToolCallPanel + CitationPanel |
| ENTY-06 | CRUD analyst investigation notes | New REST API + PostgreSQL table; inline editing in Notes tab component |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | Existing | Full-stack framework | Already in use, page.server.ts + API routes pattern |
| shadcn-svelte Tabs | Existing | Tab component (bits-ui based) | Already imported in entity page |
| @anthropic-ai/sdk | Existing | Claude API for biography | Same client as chat API (Phase 2) |
| PostgreSQL | 16 | Notes storage, bio caching | Already primary DB |
| Neo4j | 5 | Entity graph queries | Already used for connections/co-occurrences |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| DOMPurify | Existing | Sanitize AI biography HTML | SEC-02: all AI-generated content |
| @lucide/svelte | Existing | Icons (Edit, Trash, etc.) | Notes action buttons, header icons |
| bits-ui | Existing | Accessible select/dropdown | Document type filter dropdown |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side doc filtering | Server-side with URL params | Client-side simpler for <200 docs, server-side needed for pagination |
| entities.description for bio | Separate biography table | Separate table is cleaner but entities.description already exists in schema |
| Timeline from Neo4j events | Timeline from document dates | Neo4j events preferred but may be sparse; fallback to document created_at |

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── routes/(app)/entities/[id]/
│   ├── +page.server.ts          # Extended data loading (connections, timeline, notes)
│   └── +page.svelte             # Refactored 5-tab dossier layout
├── routes/api/entities/[id]/
│   ├── biography/+server.ts     # SSE biography generation endpoint
│   └── notes/+server.ts         # Notes CRUD REST endpoint
├── lib/features/entities/components/
│   ├── DossierHeader.svelte     # Entity header with name, type, aliases, counts
│   ├── DocumentsTab.svelte      # Documents list with search + filter
│   ├── ConnectionsTab.svelte    # Merged connections + co-occurrences
│   ├── TimelineTab.svelte       # Chronological events
│   ├── BiographyTab.svelte      # AI bio with streaming + citations
│   ├── NotesTab.svelte          # Notes list + inline CRUD
│   ├── NoteEditor.svelte        # Single note inline editor
│   └── EntityHoverCard.svelte   # (existing)
├── lib/types/index.ts           # Extended with InvestigationNote, EntityBiography types
└── lib/server/
    ├── anthropic.ts             # (existing) Anthropic client
    ├── tools/                   # (existing) Investigation tools
    ├── db.ts                    # (existing) PostgreSQL helper
    └── neo4j.ts                 # (existing) Neo4j helper
```

### Pattern 1: SSE Biography Streaming (reuse chat pattern)
**What:** Same tool loop as `/api/chat` but single-shot with entity-specific system prompt
**When to use:** Biography generation endpoint
**Key difference from chat:** No message history, single turn, entity-focused prompt, cache result on completion

### Pattern 2: Notes CRUD via SvelteKit API Route
**What:** Single +server.ts handling GET (list), POST (create), PUT (update), DELETE methods
**When to use:** `/api/entities/[id]/notes/+server.ts`
**Pattern:** Request method routing, parameterized SQL, JSON responses

### Pattern 3: Tab Component Decomposition
**What:** Extract each tab's content into a separate Svelte component
**When to use:** Keeps +page.svelte manageable; each tab component owns its own state
**Pattern:** Parent passes data via props, tab components handle their own interactivity

### Anti-Patterns to Avoid
- **Monolithic page component:** Don't put all 5 tabs' logic in +page.svelte (current page is already 222 lines with 3 tabs)
- **Re-implementing streaming:** Don't write new SSE parsing; reuse existing `parseSSE()` and `writeSSE()` patterns
- **Modal dialogs for notes:** CONTEXT.md explicitly says inline editing, no modals
- **Fetching all documents upfront:** Current LIMIT 50 on docs query is good; add pagination for large result sets

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tab state management | Custom tab switching | shadcn-svelte Tabs (bits-ui) | Already in use, handles ARIA, keyboard nav |
| SSE streaming | Custom fetch + parser | Existing `parseSSE()` from `$lib/features/chat/sse.ts` | Battle-tested in Phase 2, handles reconnection |
| HTML sanitization | Custom sanitizer | DOMPurify via `sanitizeChatContent()` | SEC-02 requirement, already wired up |
| Dropdown/select | Custom select | bits-ui Select or shadcn-svelte Select | Accessible, keyboard-navigable |
| Toast notifications | Custom alerts | sonner (already installed) | For note save/delete confirmations |

## Common Pitfalls

### Pitfall 1: Neo4j ID Instability
**What goes wrong:** Neo4j internal IDs (`id(e)`) can change after database compaction/restart
**Why it happens:** Internal IDs are not stable identifiers in Neo4j 5
**How to avoid:** The codebase already uses `id(e)` -- this is an inherited risk. For new code, prefer entity properties (canonical_name + entity_type) as lookup keys where possible.
**Warning signs:** Entity links breaking after database maintenance

### Pitfall 2: Biography Caching in entities.description
**What goes wrong:** entities.description may already have manually-set descriptions; overwriting with AI bio loses them
**Why it happens:** Schema reuse without separation of concerns
**How to avoid:** Add a `biography` text column and `biography_generated_at` timestamptz column to entities table, or use a separate field in entities.metadata JSONB. Recommend: add dedicated columns for clarity.
**Warning signs:** entities with existing descriptions losing them after bio generation

### Pitfall 3: Missing investigation_notes Table
**What goes wrong:** Table doesn't exist in PostgreSQL; notes CRUD fails
**Why it happens:** Schema only has the table name referenced in MCP servers, not created in init schema
**How to avoid:** Create migration SQL or add to init schema. Need: id, entity_id (references entities or Neo4j ID), content, created_at, updated_at.
**Warning signs:** 500 errors on notes API calls

### Pitfall 4: Entity ID Mismatch Between Neo4j and PostgreSQL
**What goes wrong:** Neo4j uses internal integer IDs, PostgreSQL entities table uses UUID
**Why it happens:** Two separate data stores with different ID systems
**How to avoid:** Notes should reference Neo4j entity ID (which the current URL uses) as a string/text column, not as a foreign key to PostgreSQL entities table. The PostgreSQL entities table may not have the same entities as Neo4j.
**Warning signs:** Notes not showing for entities, foreign key constraint violations

### Pitfall 5: Large Document Lists Without Pagination
**What goes wrong:** Entities with 500+ document mentions render a huge list
**Why it happens:** Current query has LIMIT 50 but no offset/pagination
**How to avoid:** Implement cursor-based or offset pagination; show "Load more" button at bottom of Documents tab
**Warning signs:** Slow page loads for well-documented entities, browser performance issues

## Code Examples

### SSE Biography Endpoint (adapting chat pattern)
```typescript
// frontend/src/routes/api/entities/[id]/biography/+server.ts
// Reuse: createAnthropicClient, toolDefinitions, executeTool
// Same tool loop as /api/chat but single-turn with entity context
export const POST: RequestHandler = async ({ params, platform }) => {
  const anthropic = createAnthropicClient(platform);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  // ... same streaming pattern as /api/chat/+server.ts
  // On completion: cache result in entities.biography column
};
```

### Notes CRUD REST Pattern
```typescript
// frontend/src/routes/api/entities/[id]/notes/+server.ts
export const GET: RequestHandler = async ({ params, platform }) => {
  const notes = await query(platform,
    'SELECT * FROM investigation_notes WHERE entity_id = $1 ORDER BY created_at DESC',
    [params.id]
  );
  return json(notes);
};

export const POST: RequestHandler = async ({ request, params, platform }) => {
  const { content } = await request.json();
  const result = await query(platform,
    'INSERT INTO investigation_notes (entity_id, content) VALUES ($1, $2) RETURNING *',
    [params.id, content]
  );
  return json(result[0], { status: 201 });
};
```

### Tab with Count Label
```svelte
<!-- Svelte 5 pattern for tabs with dynamic counts -->
<Tabs.Trigger value="documents">Documents ({data.documents.length})</Tabs.Trigger>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte stores | Svelte 5 runes ($state, $derived) | Svelte 5 | Use $state for tab content, $derived for filtered lists |
| on:click handlers | onclick attribute | Svelte 5 | Event handlers are plain attributes |
| createEventDispatcher | callback props | Svelte 5 | Pass functions as props for child-to-parent communication |

## Open Questions

1. **Neo4j Event Nodes Availability**
   - What we know: Neo4j has entities (Person, Organization, Location) and Document nodes with MENTIONED_IN relationships
   - What's unclear: Whether Event nodes exist in the graph. The schema shows entities and documents but timeline events may not be extracted yet (Phase 6 covers date extraction pipeline)
   - Recommendation: Query Neo4j for Event-labeled nodes. If none exist, Timeline tab shows document mentions in chronological order (by document created_at). Add "Events will be enriched in a future update" notice.

2. **PostgreSQL entities Table Population**
   - What we know: PostgreSQL `entities` table exists with `aliases`, `description`, `metadata` columns. Neo4j also has entities.
   - What's unclear: Whether PostgreSQL entities are synced with Neo4j entities, or if they're separate datasets
   - Recommendation: For notes, use Neo4j entity ID (from URL) as the reference key. For bio caching, check if a matching PostgreSQL entity exists; if not, store in a separate table or create on demand.

3. **investigation_notes Table**
   - What we know: Referenced in MCP servers and CLAUDE.md but not in 01-schema.sql
   - What's unclear: Whether it was created via manual migration on the server
   - Recommendation: Create table via migration SQL in plan. Use entity_neo4j_id (text) as reference, not FK to entities table.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `frontend/src/routes/(app)/entities/[id]/+page.svelte` (current entity page)
- Codebase analysis: `frontend/src/routes/api/chat/+server.ts` (SSE streaming tool loop)
- Codebase analysis: `frontend/src/lib/types/index.ts` (existing type definitions)
- Codebase analysis: `config/postgres/init/01-schema.sql` (database schema)
- Codebase analysis: `frontend/src/lib/features/chat/components/` (reusable UI components)

### Secondary (MEDIUM confidence)
- CLAUDE.md project documentation (investigation_notes table reference, architecture)
- Phase 2 plans (patterns established for SSE streaming, tool calls, citations)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in codebase
- Architecture: HIGH - extending existing patterns, not introducing new ones
- Pitfalls: HIGH - identified from direct codebase analysis of ID systems and schema gaps

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable - extending existing patterns)
