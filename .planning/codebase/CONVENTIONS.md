# Coding Conventions

**Analysis Date:** 2026-03-07

## Naming Patterns

**Files:**
- Svelte components: PascalCase (`SearchResults.svelte`, `ChatInput.svelte`, `GraphCanvas.svelte`)
- Svelte UI primitives: kebab-case (`card-content.svelte`, `accordion-trigger.svelte`, `dialog-close.svelte`)
- TypeScript modules: camelCase or kebab-case (`stores.svelte.ts`, `sse.ts`, `db.ts`)
- SvelteKit routes: follow SvelteKit conventions (`+page.svelte`, `+server.ts`, `+page.server.ts`, `+layout.svelte`)
- Backend/processing JS files: kebab-case or single-word (`index.js`, `extract.js`, `r2-sync.ts`)
- Shell scripts: kebab-case (`batch-processor.sh`, `check-processing-status.sh`)

**Functions:**
- Use camelCase for all functions: `handleSearch()`, `fulltextSearch()`, `performSearch()`, `parseSSE()`
- Prefix event handlers with `handle`: `handleSearch()`, `handleModeChange()`, `handlePageChange()`, `handleKeyPress()`
- Async functions use `async`/`await` throughout, never raw `.then()` chains

**Variables:**
- camelCase for local variables and state: `searchInput`, `sidebarCollapsed`, `mobileOpen`
- SCREAMING_SNAKE_CASE for environment constants: `API_SECRET_KEY`, `REDIS_URL`, `QDRANT_API_KEY`
- Svelte 5 runes for reactive state: `$state()`, `$props()`, `$derived()`

**Types:**
- PascalCase for interfaces and types: `SearchResult`, `DocumentMessage`, `EntityType`, `GraphNode`
- Prefix with intent when possible: `SearchFilters`, `ChatRequest`, `QdrantPayload`
- Use `interface` for object shapes, `type` for unions/aliases: `type SearchMode = 'fulltext' | 'semantic' | 'hybrid'`
- Type aliases for entity types: `type EntityType = 'Person' | 'Organization' | 'Location'`

## Code Style

**Formatting:**
- No dedicated formatter configured (no Prettier, no Biome)
- Frontend uses tabs for indentation (SvelteKit default)
- Backend/Worker uses 2-space indentation
- MCP proxy uses 2-space indentation
- Single quotes in TypeScript/Svelte files
- Double quotes in plain JavaScript files (`mcp-http-proxy/index.js`, `cloudflare-worker/api-backend/index.js`)
- Trailing commas in multi-line objects/arrays in TypeScript

**Linting:**
- No ESLint, Biome, or other linter configured at project level
- TypeScript strict mode enabled in both `frontend/tsconfig.json` and `cloudflare-worker/tsconfig.json`
- `svelte-check` used for frontend type checking: `npm run check` in `frontend/`
- `tsc --noEmit` used for worker type checking: `npm run typecheck` in `cloudflare-worker/`

## Import Organization

**Order (observed pattern, not enforced):**
1. Framework imports (`svelte`, `@sveltejs/kit`, `hono`)
2. Third-party library imports (`pg`, `neo4j-driver`, `@qdrant/js-client-rest`)
3. Internal imports via `$lib/` alias (`$lib/server/db`, `$lib/components/ui/card`)
4. Type-only imports (`import type { ... }`)
5. Relative imports (`./workflow`, `./button.svelte`)

**Path Aliases:**
- `$lib` → `frontend/src/lib/` (SvelteKit built-in)
- `$lib/server` → server-only modules (db, neo4j, qdrant clients)
- `$lib/components` → shared UI components
- `$lib/features` → feature-specific modules
- `$lib/types` → shared TypeScript types
- `$lib/utils` → shared utility functions
- `$app/navigation`, `$app/stores` → SvelteKit runtime modules

**Import style:**
```typescript
// Named imports preferred
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query as dbQuery } from '$lib/server/db';
import type { SearchResult, SearchMode } from '$lib/types';

// Namespace imports for UI component sets
import * as Sheet from '$lib/components/ui/sheet';
```

## Error Handling

**Backend (Cloudflare Worker - `cloudflare-worker/src/index.ts`):**
- Every route handler wrapped in `try/catch`
- Return JSON error responses with appropriate HTTP status codes
- Log errors with `console.error()` and category prefix: `console.error('Search error:', error)`
- Include `requestId` in error responses for tracing
- Non-critical failures (cache writes) use empty `catch` blocks with inline comments

```typescript
// Standard error handler pattern
try {
  // ... logic
} catch (error) {
  console.error('Operation error:', error);
  return c.json({ error: 'Operation failed' }, 500);
}
```

**Frontend API routes (`frontend/src/routes/api/`):**
- Return `json({ error: String(error) }, { status: 500 })` for server errors
- Input validation returns 400 with descriptive message
- Platform availability check at route entry: `if (!platform?.env) { return json({ error: '...' }, { status: 500 }); }`

**Frontend stores (`frontend/src/lib/features/*/stores.svelte.ts`):**
- `try/catch/finally` pattern with `loading` and `error` state
- Error messages extracted from Error instances: `err instanceof Error ? err.message : 'Default'`

```typescript
try {
  this.loading = true;
  this.error = null;
  // ... async work
} catch (err) {
  this.error = err instanceof Error ? err.message : 'Operation failed';
} finally {
  this.loading = false;
}
```

**MCP HTTP Proxy (`mcp-http-proxy/index.js`):**
- Fail-fast on missing critical config: `if (!API_SECRET_KEY) { process.exit(1); }`
- Redis errors logged but non-fatal (graceful degradation)
- SIGTERM handler for clean shutdown

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- `console.error('Category error:', error)` for errors
- `console.warn('Warning message')` for non-critical issues
- `console.log()` for startup/info messages in Node.js services
- No logging in frontend Svelte components
- No log levels beyond what `console` provides

## Comments

**When to Comment:**
- Explain *why* for non-obvious technical decisions: `// Queue consumer removed -- direct batch processing via /process/batch is the primary method.`
- Inline comments for empty catch blocks: `// Cache miss or D1 unavailable, continue to origin`
- Brief purpose comments for middleware: `// Request ID middleware for tracing`
- No JSDoc/TSDoc usage anywhere in the codebase

**What NOT to comment:**
- Self-explanatory code is not commented
- No file-level documentation headers
- No function documentation blocks

## Function Design

**Size:** Functions are medium-length (20-80 lines typical). Larger route handlers (~100 lines) exist in `cloudflare-worker/src/index.ts` but are self-contained per endpoint.

**Parameters:**
- Destructure request bodies inline: `const { query, limit = 10, filters } = body`
- Default parameter values at destructure site
- Platform/env passed as first parameter in server functions: `query(platform, sql, params)`

**Return Values:**
- API routes return `json()` or `new Response()`
- Database functions return typed arrays: `Promise<T[]>` or `Promise<T | null>`
- Client factory functions return object literals with async methods

## Module Design

**Exports:**
- Named exports for functions and types (never default exports for TS modules)
- Default export only for Svelte components (implicit) and Hono app
- UI component barrel files export both named and aliased: `Root as Card`

**Barrel Files:**
- Every UI component directory has an `index.ts` barrel file
- Feature directories use barrel files for component re-exports: `frontend/src/lib/features/graph/index.ts`
- Types centralized in `frontend/src/lib/types/index.ts`
- Utils centralized in `frontend/src/lib/utils/index.ts`

**UI Component Pattern (shadcn-svelte):**
```typescript
// frontend/src/lib/components/ui/card/index.ts
import Root from "./card.svelte";
import Content from "./card-content.svelte";
export {
  Root,
  Content,
  Root as Card,
  Content as CardContent,
};
```

## State Management

**Svelte 5 Runes (frontend):**
- Use `$state()` for reactive variables
- Use `$props()` for component props with interface typing
- Use `$derived()` for computed values (via getters in store classes)
- Stores are singleton class instances: `export const searchStore = new SearchStore()`
- Store files named `stores.svelte.ts` (Svelte 5 convention)

```typescript
// frontend/src/lib/features/search/stores.svelte.ts
class SearchStore {
  query = $state('');
  loading = $state(false);
  results = $state<SearchResult[]>([]);

  get hasResults() { return this.results.length > 0; }
  async performSearch() { /* ... */ }
}
export const searchStore = new SearchStore();
```

## API Design

**HTTP Framework:** Hono used across all backends (Cloudflare Worker, MCP proxy, API backend)

**Authentication pattern:**
- Internal endpoints require `X-API-Key` header matching `API_SECRET_KEY`
- Middleware function `requireAuth` checks key before route execution
- Frontend auth via Cloudflare Access JWT (header `Cf-Access-Authenticated-User-Email`)

**Response format:**
- Always JSON: `c.json({ ... })` or SvelteKit `json({ ... })`
- Error responses include `error` field: `{ error: 'Description' }`
- Success responses include relevant data + `requestId` for tracing
- Paginated results include `total`, `results`, and relevant metadata

**Input validation pattern:**
```typescript
if (!query || typeof query !== 'string') {
  return c.json({ error: 'Query string required' }, 400);
}
```

## Styling

**CSS Framework:** Tailwind CSS v4 with `@tailwindcss/vite` plugin
- Utility-first classes in Svelte templates
- `cn()` helper for conditional class merging (`clsx` + `tailwind-merge`)
- CSS custom properties for theming: `var(--color-entity-person)`
- `tailwind-variants` for component variant definitions (used by shadcn-svelte)

## TypeScript Strictness

**Enabled in all TypeScript projects:**
- `strict: true` in `frontend/tsconfig.json` and `cloudflare-worker/tsconfig.json`
- `checkJs: true` in frontend (JavaScript files also type-checked)
- `skipLibCheck: true` everywhere
- Target: ES2022 for Workers, ESNext module resolution

**Type assertion patterns:**
- `as` casts for API response parsing: `(await response.json()) as SearchResponse`
- Platform env typed via `App.Platform` interface in `frontend/src/app.d.ts`
- `Record<string, unknown>` for generic object shapes

---

*Convention analysis: 2026-03-07*
