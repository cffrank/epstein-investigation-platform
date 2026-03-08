# Phase 1: Security and Foundation - Research

**Researched:** 2026-03-07
**Domain:** Security hardening, performance optimization, test infrastructure, monorepo setup
**Confidence:** HIGH

## Summary

Phase 1 closes critical security vulnerabilities (Cypher injection, XSS, auth bypass, raw SQL proxy), fixes performance bottlenecks (ILIKE full-table scans, COUNT queries, hybrid search), establishes test infrastructure (Vitest + CI gates), resolves 20 frontend TypeScript errors, and extracts shared modules into a monorepo workspace package. The existing codebase uses Hono across all backends, SvelteKit with Cloudflare Pages adapter on the frontend, PostgreSQL/Qdrant/Neo4j for data stores, and GitHub Actions for CI.

All fixes use standard, well-documented patterns: DOMPurify for XSS, parameterized queries and allowlists for injection, Vitest for testing, Biome for linting/formatting, and npm workspaces for monorepo structure. No novel technical challenges exist -- this is applying established security and DevOps best practices to close known gaps identified in the code review.

**Primary recommendation:** Fix security vulnerabilities first (injection, XSS, auth), then performance, then extract shared modules, then test infrastructure and CI, then TS error cleanup last. Security fixes are prerequisite to everything else.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- CI/CD: GitHub Actions extending existing `.github/workflows/deploy-frontend.yml`, block merges on test failure, auto-deploy on merge to main
- CI checks: Vitest tests, TypeScript type checking (svelte-check + tsc --noEmit), Biome lint/format, build verification, npm audit
- Linter/formatter: Biome (already available globally)
- Test foundation: Critical paths only (~15-20 tests), both frontend (Vitest) and Cloudflare Worker (@cloudflare/vitest-pool-workers)
- All tests use mocked dependencies (no live DB required in CI)
- SQL proxy replacement (SEC-13): Typed API endpoints + read-only ad-hoc query endpoint behind API key auth on internal network
- Read-only PostgreSQL role for ad-hoc endpoint
- Shared module: npm workspaces monorepo, package at `packages/shared/`, imported as `@epstein/shared`
- Shared package scope: query builders, parameterization, auth guard logic, input validation/sanitization, shared TypeScript types
- TypeScript migration: MCP proxy (302 lines) and API backend to TypeScript, both consume shared package types
- New code in future phases must include tests (CI enforced)

### Claude's Discretion
- Exact Biome configuration rules
- Which typed API endpoints to create (based on usage analysis)
- Mock vs integration test split decisions
- Order of security fix implementation within the phase
- DOMPurify configuration details
- Cypher allowlist implementation approach
- How to handle the 20 frontend TS errors (batch fix vs incremental)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Fix Cypher injection in graph traversal endpoint (CR-002) | Allowlist validation of relationship types against known Neo4j relationship types; parameterize all dynamic Cypher components |
| SEC-02 | Sanitize all `{@html}` renders with DOMPurify (HI-001, HI-002, HI-003) | Use `isomorphic-dompurify` for SSR+client, 3 specific `{@html}` locations identified |
| SEC-03 | Fix Cypher query blocklist bypass via APOC (HI-004) | Replace blocklist with read-only Neo4j user for query endpoints |
| SEC-04 | Enforce authentication in frontend hooks (CR-006) | Add auth check in `hooks.server.ts`, block unauthenticated requests to `/api/` routes |
| SEC-05 | Remove hardcoded API key in batch-processor.sh (HI-005) | Replace with `${API_SECRET_KEY:?must be set}` environment variable |
| SEC-06 | Fix MCP server default to public IP without SSL (HI-006) | Change default host to `localhost`, require SSL for non-localhost |
| SEC-07 | Fix ILIKE full table scans on 961K documents (CR-003) | Replace ILIKE with `search_vector @@ plainto_tsquery()` or Neo4j entity lookups |
| SEC-08 | Fix fulltext search COUNT query performance (CR-005) | Use capped count CTE: `SELECT COUNT(*) FROM (SELECT 1 FROM ... LIMIT 10001)` |
| SEC-09 | Optimize hybrid search performance (HI-007, HI-008) | Skip COUNT in fulltext leg of hybrid; use Qdrant native `offset` parameter |
| SEC-10 | Fix unbounded chat context growth (HI-009) | Implement sliding window: last 6 messages + current turn |
| SEC-11 | Parallelize Worker batch processing (HI-010) | Use `Promise.all()` with chunks of 5 instead of sequential `for` loop |
| SEC-12 | Extract shared service modules (HI-011) | npm workspaces with `packages/shared/` containing query builders, auth guards, types, validation |
| SEC-13 | Replace raw SQL proxy with proper API endpoints (HI-012) | Create typed Hono endpoints for document search, stats, entity listing; retain read-only ad-hoc endpoint |
| SEC-14 | Add CI/CD pipeline for Worker and backend (HI-013) | Extend GitHub Actions workflow with Worker deploy (wrangler deploy) and backend deploy (SSH) |
| SEC-15 | Set up Vitest + basic CI gate (CR-004) | Vitest for frontend, @cloudflare/vitest-pool-workers for Worker, ~15-20 tests for SQL builders, auth guards, SSE parser |
| SEC-16 | Resolve all 20 frontend TypeScript errors | Fix TS errors to achieve zero-error `svelte-check` and `tsc --noEmit` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^3.x | Test runner for frontend and shared package | Vite-native, zero-config TypeScript, used by SvelteKit ecosystem |
| @cloudflare/vitest-pool-workers | ^0.8.x | Test runner for Cloudflare Worker code | Official Cloudflare testing solution, runs tests in Workers runtime. Compatible with Vitest 2.0-3.2 |
| isomorphic-dompurify | ^3.x | XSS sanitization (SSR + client) | Works identically on server and client, wraps DOMPurify for isomorphic use. v3 has ESM support |
| @biomejs/biome | latest | Linting + formatting (single tool) | Already used in project (global CLAUDE.md references `npx biome format --write`). Replaces ESLint + Prettier |
| hono | ^4.x | HTTP framework (already in use) | Already used across all backends -- MCP proxy, API backend, Worker |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/svelte | ^5.x | Svelte component test utilities | Only if component-level tests are added (optional for Phase 1) |
| pg (types: @types/pg) | ^8.x | PostgreSQL client (already in use) | TypeScript migration of MCP proxy and API backend |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| isomorphic-dompurify | dompurify (client-only) | Would need separate server sanitization logic; isomorphic simplifies SSR |
| @cloudflare/vitest-pool-workers | plain vitest with mocks | Loses Workers runtime fidelity; plain vitest is fine for unit tests but won't catch Workers API issues |
| npm workspaces | pnpm workspaces | Project uses npm (no pnpm.lock exists), switching adds unnecessary migration risk |

**Installation:**
```bash
# Root (new)
npm install --save-dev --save-exact @biomejs/biome vitest

# Frontend
cd frontend && npm install isomorphic-dompurify && npm install --save-dev vitest @testing-library/svelte

# Cloudflare Worker
cd cloudflare-worker && npm install --save-dev vitest @cloudflare/vitest-pool-workers

# Shared package (new)
mkdir -p packages/shared && cd packages/shared && npm init --scope=@epstein -y
```

## Architecture Patterns

### Recommended Project Structure (Post Phase 1)
```
/
├── package.json                 # Root with "workspaces": ["packages/*", "frontend", "cloudflare-worker", "mcp-http-proxy"]
├── biome.json                   # Root Biome config (applies to all packages)
├── packages/
│   └── shared/
│       ├── package.json         # @epstein/shared
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts         # Barrel export
│           ├── query-builders/  # Parameterized SQL/Cypher builders
│           │   ├── sql.ts       # PostgreSQL query builders
│           │   └── cypher.ts    # Neo4j Cypher builders with allowlists
│           ├── auth/
│           │   └── guards.ts    # requireAuth, requireApiKey, fail-closed
│           ├── validation/
│           │   └── sanitize.ts  # Input validation, DOMPurify wrappers
│           └── types/
│               └── index.ts     # Shared TypeScript interfaces (moved from frontend)
├── frontend/                    # SvelteKit app (imports @epstein/shared)
├── cloudflare-worker/           # CF Worker + api-backend/ (both import @epstein/shared)
│   ├── api-backend/
│   │   ├── index.ts             # Migrated from .js
│   │   └── tsconfig.json
│   └── src/
│       └── index.ts             # Worker entry
├── mcp-http-proxy/
│   ├── index.ts                 # Migrated from .js
│   └── tsconfig.json
└── .github/
    └── workflows/
        └── ci.yml               # Extended from deploy-frontend.yml
```

### Pattern 1: Parameterized Cypher with Allowlist
**What:** Validate all dynamic Cypher components against a static allowlist of known values.
**When to use:** Any endpoint that interpolates user input into Cypher queries (CR-002, HI-004).
**Example:**
```typescript
// packages/shared/src/query-builders/cypher.ts
const ALLOWED_RELATIONSHIP_TYPES = new Set([
  'MENTIONED_IN', 'CONNECTED_TO', 'ASSOCIATED_WITH',
  'WORKS_FOR', 'LOCATED_IN', 'RELATED_TO'
  // Add all actual relationship types from Neo4j
]);

const ALLOWED_NODE_LABELS = new Set(['Person', 'Organization', 'Location', 'Document', 'Event']);

export function validateRelationshipTypes(types: string[]): string[] {
  return types.filter(t => ALLOWED_RELATIONSHIP_TYPES.has(t));
}

export function buildTraversalQuery(
  relationshipTypes: string[],
  maxDepth: number
): { query: string; params: Record<string, unknown> } {
  const safeDepth = Math.min(Math.max(maxDepth, 1), 4);
  const validTypes = validateRelationshipTypes(relationshipTypes);

  // Use parameterized pattern - no string interpolation of user input
  let relPattern = validTypes.length > 0
    ? `[:${validTypes.join('|')}*1..${safeDepth}]`
    : `[*1..${safeDepth}]`;

  return {
    query: `
      MATCH (start {name: $startNode})
      MATCH path = (start)-${relPattern}-(connected)
      WITH connected, min(length(path)) as distance
      RETURN DISTINCT connected.name as name,
             labels(connected) as labels,
             distance
      ORDER BY distance, name
      LIMIT $limit
    `,
    params: {} // startNode and limit added by caller
  };
}
```

### Pattern 2: Fail-Closed Auth Guard
**What:** Auth middleware that refuses to operate when credentials are missing.
**When to use:** All API endpoints (CR-007, CR-006).
**Example:**
```typescript
// packages/shared/src/auth/guards.ts
export function createRequireApiKey(apiSecretKey: string) {
  if (!apiSecretKey) {
    throw new Error('FATAL: API_SECRET_KEY not set. Cannot create auth guard.');
  }
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== apiSecretKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}

// In hooks.server.ts (SEC-04)
export const handle: Handle = async ({ event, resolve }) => {
  const email = event.request.headers.get('Cf-Access-Authenticated-User-Email');
  if (email) {
    event.locals.user = { email };
  }

  // Block unauthenticated API requests
  if (event.url.pathname.startsWith('/api/') && !event.locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return resolve(event);
};
```

### Pattern 3: Capped Count for Pagination
**What:** Avoid full COUNT(*) scans by capping at a practical limit.
**When to use:** Any pagination query on the 961K documents table (CR-005).
**Example:**
```typescript
// packages/shared/src/query-builders/sql.ts
export function buildCappedCountSql(whereClause: string): string {
  return `
    WITH limited AS (
      SELECT 1 FROM documents
      WHERE ${whereClause}
      LIMIT 10001
    )
    SELECT COUNT(*) as count FROM limited
  `;
  // Frontend shows "10,000+" when count === 10001
}
```

### Pattern 4: DOMPurify Sanitization Wrapper
**What:** Centralized HTML sanitization for all `{@html}` renders.
**When to use:** Every `{@html}` in the frontend (3 locations identified).
**Example:**
```typescript
// packages/shared/src/validation/sanitize.ts
import DOMPurify from 'isomorphic-dompurify';

export function sanitizeSearchSnippet(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['mark'],  // Only allow search highlighting
    ALLOWED_ATTR: []
  });
}

export function sanitizeChatContent(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'mark'],
    ALLOWED_ATTR: ['href', 'class']
  });
}

export function sanitizeDocumentText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['mark', 'span'],
    ALLOWED_ATTR: ['class']
  });
}
```

### Anti-Patterns to Avoid
- **String interpolation in Cypher/SQL:** Never build queries by concatenating user input. Always use parameterized queries or validate against allowlists.
- **Blocklist-based query filtering:** The existing Cypher blocklist (checking for `delete`, `remove`, etc.) is trivially bypassed. Use a read-only database user instead.
- **Auth that skips on missing config:** The `if (API_SECRET_KEY && ...)` pattern silently disables auth. Always fail closed.
- **Full COUNT(*) on large tables:** Never run unbounded COUNT on 961K rows for pagination. Cap or estimate.
- **Raw `{@html}` without sanitization:** Every `{@html}` must pass through DOMPurify. No exceptions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML sanitization | Regex-based tag stripping | isomorphic-dompurify | Edge cases in HTML parsing are endless; DOMPurify is battle-tested by security researchers |
| Cypher read-only enforcement | Keyword blocklist | Neo4j read-only user role | Blocklists always have gaps (APOC, CALL, DETACH, Unicode tricks). DB-level enforcement is airtight |
| Test runner | Custom test scripts | Vitest | Vite-native, TypeScript support, watch mode, coverage, mocking -- all built in |
| Linting + formatting | ESLint + Prettier | Biome | Single tool, faster, already in use. No config conflicts between linter and formatter |
| Monorepo package linking | Manual symlinks | npm workspaces | Handles dependency resolution, hoisting, and cross-package imports automatically |

**Key insight:** Security features (sanitization, auth, injection prevention) should never be hand-rolled. The attack surface is too large and the standard solutions are too good.

## Common Pitfalls

### Pitfall 1: Cypher Allowlist Incomplete
**What goes wrong:** Allowlist of relationship types or node labels misses types that exist in the database, breaking existing functionality.
**Why it happens:** The Neo4j database has relationships created by automated pipelines; the developer doesn't know all types.
**How to avoid:** Query Neo4j for all existing relationship types (`CALL db.relationshipTypes()`) and node labels (`CALL db.labels()`) before building the allowlist. Store the allowlist in a config file that can be updated.
**Warning signs:** Graph traversal returns empty results for previously working queries.

### Pitfall 2: isomorphic-dompurify in Cloudflare Workers Runtime
**What goes wrong:** DOMPurify and isomorphic-dompurify depend on a DOM environment. Cloudflare Workers have no DOM.
**Why it happens:** The SvelteKit frontend runs on Cloudflare Pages (which has a Workers-like runtime), and the shared package might be imported by both frontend and backend.
**How to avoid:** DOMPurify sanitization should only run in the SvelteKit frontend (which has SSR via Pages). Backend API endpoints should not need HTML sanitization -- they return JSON data. Keep sanitization calls in Svelte components or SvelteKit server routes, not in the shared package's runtime code. The shared package can export config/types but actual DOMPurify calls happen in the frontend.
**Warning signs:** Build errors about missing `window` or `document` in Workers.

### Pitfall 3: npm Workspaces with Cloudflare Pages
**What goes wrong:** Cloudflare Pages build system doesn't understand npm workspaces -- it runs `npm install` in the frontend directory, missing the shared package.
**Why it happens:** Pages builds run in an isolated context with a configured root directory.
**How to avoid:** Set the Pages build root to the repository root (not `frontend/`). Update the build command to `cd frontend && npm run build`. Configure the Pages project to use the root `package-lock.json` for dependency resolution.
**Warning signs:** Build fails with "Cannot find module @epstein/shared" in Pages deployment.

### Pitfall 4: MCP Proxy TS Migration Breaks Docker
**What goes wrong:** After migrating MCP proxy from `.js` to `.ts`, the Docker container fails to start because it's running `node index.js` but the file is now `index.ts`.
**Why it happens:** The `Dockerfile` and `docker-compose.yml` reference the old file.
**How to avoid:** Add a TypeScript build step to the MCP proxy package. Update the Docker configuration to build TypeScript first, then run the compiled output. Use `tsx` or `esbuild` for fast compilation.
**Warning signs:** Container restart loop after deployment.

### Pitfall 5: Read-Only PostgreSQL Role Missing Permissions
**What goes wrong:** The read-only role can't access tables or views because `GRANT SELECT` was only applied to existing tables, not future ones.
**Why it happens:** PostgreSQL's `GRANT` only affects existing objects by default.
**How to avoid:** Use `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_role;` to cover future tables. Also grant `USAGE` on the schema.
**Warning signs:** Queries return "permission denied" errors after new tables are created.

### Pitfall 6: Vitest Config Conflicts Between Frontend and Worker
**What goes wrong:** A single Vitest config can't handle both SvelteKit (needs Svelte plugin) and Cloudflare Worker (needs Workers pool) tests.
**Why it happens:** Different test environments need different Vitest configurations.
**How to avoid:** Each package gets its own `vitest.config.ts`. The root `package.json` runs all test suites via `npm run test --workspaces`. The CI workflow runs tests per-workspace.
**Warning signs:** Import errors or "Cannot find module" in test runs.

## Code Examples

### Replacing ILIKE with Full-Text Search (SEC-07)
```typescript
// BEFORE (CR-003 - full table scan on 961K docs):
const result = await pool.query(
  `SELECT COUNT(*) as count FROM documents
   WHERE metadata->>'extracted_text' ILIKE $1`,
  [`%${personName}%`]
);

// AFTER - Use existing search_vector tsvector column:
const result = await pool.query(
  `SELECT COUNT(*) as count FROM documents
   WHERE search_vector @@ plainto_tsquery('english', $1)`,
  [personName]
);

// For person mention lookups, prefer Neo4j which already indexes entities:
// MATCH (p:Person {name: $name})-[:MENTIONED_IN]->(d:Document)
// RETURN count(d) as count
```

### Chat Context Sliding Window (SEC-10)
```typescript
// BEFORE (unbounded - sends ALL messages):
body: JSON.stringify({ messages })

// AFTER - sliding window of last 6 messages:
const MAX_CONTEXT_MESSAGES = 6;
const contextMessages = messages.length <= MAX_CONTEXT_MESSAGES
  ? messages
  : [
      // Always include system context
      ...messages.slice(0, 1),
      // Last N messages for conversation continuity
      ...messages.slice(-(MAX_CONTEXT_MESSAGES - 1))
    ];
body: JSON.stringify({ messages: contextMessages })
```

### Worker Batch Parallelization (SEC-11)
```typescript
// BEFORE (sequential - 3-5s per doc):
for (const doc of documents) {
  // ... process one at a time
}

// AFTER (parallel chunks of 5):
const CHUNK_SIZE = 5;
for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
  const chunk = documents.slice(i, i + CHUNK_SIZE);
  const results = await Promise.all(
    chunk.map(doc => processDocument(doc, c.env))
  );
  allResults.push(...results);
}
```

### Fail-Closed API Key (SEC-05, CR-007)
```bash
# BEFORE (batch-processor.sh - hardcoded key):
API_KEY="test-api-key-12345"

# AFTER:
API_KEY="${API_SECRET_KEY:?ERROR: API_SECRET_KEY must be set}"
```

```typescript
// BEFORE (api-backend - silently skips auth):
const API_SECRET_KEY = process.env.API_SECRET_KEY || '';
const requireApiKey = async (c, next) => {
  if (API_SECRET_KEY && apiKey !== API_SECRET_KEY) { ... }
};

// AFTER (fail closed):
const API_SECRET_KEY = process.env.API_SECRET_KEY;
if (!API_SECRET_KEY) {
  console.error('FATAL: API_SECRET_KEY not set');
  process.exit(1);
}
```

### MCP Server Default Fix (SEC-06)
```typescript
// BEFORE (defaults to public IP without SSL):
const pool = new Pool({
  host: process.env.PG_HOST || '88.99.61.233',
  ssl: false,
});

// AFTER (safe defaults):
const host = process.env.PG_HOST || 'localhost';
const pool = new Pool({
  host,
  ssl: host !== 'localhost' && host !== '127.0.0.1' ? { rejectUnauthorized: true } : false,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ESLint + Prettier | Biome | 2024+ | Single tool, 10-100x faster, fewer config conflicts |
| Jest for Vite projects | Vitest | 2023+ | Native Vite integration, same config, faster |
| Manual `{@html}` escaping | DOMPurify / isomorphic-dompurify | Long-standing | Battle-tested sanitization, handles all edge cases |
| Keyword blocklists for SQL/Cypher | Parameterized queries + read-only users | Long-standing best practice | Blocklists always have gaps; DB-level enforcement is complete |
| ESLint for CI linting | Biome check in CI | 2024+ | `biome check` runs lint + format verification in one pass |

## Open Questions

1. **Exact Neo4j relationship types in the database**
   - What we know: The graph has 917K relationships across entities
   - What's unclear: The complete set of relationship type names for the Cypher allowlist
   - Recommendation: Query `CALL db.relationshipTypes()` on the live Neo4j instance before building the allowlist. This is a runtime discovery task, not a research task.

2. **Cloudflare Pages build root with npm workspaces**
   - What we know: Pages currently builds from `frontend/` directory
   - What's unclear: Whether Pages supports npm workspaces when the build root is set to repo root
   - Recommendation: Test locally first. If Pages doesn't resolve workspace packages, use a pre-build script that bundles the shared package.

3. **Existing frontend TypeScript errors**
   - What we know: 20 errors exist, mentioned in code review
   - What's unclear: Which specific files and error types
   - Recommendation: Run `npx svelte-check` to get the full error list during implementation. Most likely type mismatches or missing type annotations.

4. **Which frontend routes currently call the MCP SQL proxy**
   - What we know: `frontend/src/lib/server/db.ts` sends raw SQL to `/mcp/query`
   - What's unclear: Exactly which page server loads and API routes use this, to determine which typed endpoints to create
   - Recommendation: Grep for `import.*db` and `dbQuery` across frontend routes during implementation. The usage patterns determine which typed endpoints replace the raw proxy.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (frontend/shared), @cloudflare/vitest-pool-workers (worker) |
| Config file | Per-package: `frontend/vitest.config.ts`, `cloudflare-worker/vitest.config.ts`, `packages/shared/vitest.config.ts` |
| Quick run command | `npm test --workspaces` |
| Full suite command | `npm test --workspaces` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Cypher traversal rejects invalid relationship types | unit | `npx vitest run packages/shared/src/query-builders/cypher.test.ts` | No - Wave 0 |
| SEC-02 | DOMPurify strips malicious HTML, preserves `<mark>` | unit | `npx vitest run frontend/src/lib/utils/sanitize.test.ts` | No - Wave 0 |
| SEC-04 | Unauthenticated requests to /api/ return 401 | unit | `npx vitest run frontend/src/hooks.server.test.ts` | No - Wave 0 |
| SEC-07 | SQL query builder uses plainto_tsquery, not ILIKE | unit | `npx vitest run packages/shared/src/query-builders/sql.test.ts` | No - Wave 0 |
| SEC-13 | Typed API endpoints return correct response shapes | unit | `npx vitest run mcp-http-proxy/src/endpoints.test.ts` | No - Wave 0 |
| SEC-15 | SSE parser yields correct events from stream | unit | `npx vitest run frontend/src/lib/features/chat/sse.test.ts` | No - Wave 0 |
| SEC-12 | Shared package exports compile and are importable | unit | `npx vitest run packages/shared/src/index.test.ts` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test --workspaces`
- **Per wave merge:** Full suite + `npx svelte-check` + `npx biome check`
- **Phase gate:** Full suite green + zero TS errors + CI pipeline green

### Wave 0 Gaps
- [ ] `packages/shared/vitest.config.ts` -- Vitest config for shared package
- [ ] `frontend/vitest.config.ts` -- Vitest config for frontend (must include Svelte plugin)
- [ ] `cloudflare-worker/vitest.config.ts` -- Vitest config with Workers pool
- [ ] `packages/shared/tsconfig.json` -- TypeScript config for shared package
- [ ] `biome.json` -- Root Biome config
- [ ] Root `package.json` with workspaces configuration
- [ ] Framework install: `npm install --save-dev vitest` (root + per-package)

## Sources

### Primary (HIGH confidence)
- [Code review report](docs/CODE-REVIEW-2026-03-07.md) -- All 38 findings with exact file locations and line numbers
- [Project CONTEXT.md](.planning/phases/01-security-and-foundation/01-CONTEXT.md) -- User decisions and constraints
- Direct codebase inspection -- `hooks.server.ts`, `api-backend/index.js`, `mcp-http-proxy/index.js`, `sse.ts`, all `{@html}` locations, `db.ts`, `neo4j.ts`, nginx config

### Secondary (MEDIUM confidence)
- [isomorphic-dompurify npm](https://www.npmjs.com/package/isomorphic-dompurify) -- v3 ESM support, SSR compatibility
- [Cloudflare Vitest integration docs](https://developers.cloudflare.com/workers/testing/vitest-integration/) -- @cloudflare/vitest-pool-workers setup, compatibility with Vitest 2.0-3.2
- [Biome configuration docs](https://biomejs.dev/reference/configuration/) -- Setup and rule configuration
- [npm workspaces with TypeScript](https://medium.com/@cecylia.borek/setting-up-a-monorepo-using-npm-workspaces-and-typescript-project-references-307841e0ba4a) -- Monorepo patterns

### Tertiary (LOW confidence)
- Cloudflare Pages npm workspaces support -- not verified with official docs, needs testing during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries are well-established, versions verified, no speculative choices
- Architecture: HIGH -- Monorepo pattern is standard npm workspaces, all integration points identified in codebase
- Pitfalls: HIGH -- All pitfalls derived from direct codebase inspection and code review findings with exact line numbers
- Security fixes: HIGH -- All fixes are standard security patterns (parameterization, DOMPurify, fail-closed auth)

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable patterns, 30-day validity)
