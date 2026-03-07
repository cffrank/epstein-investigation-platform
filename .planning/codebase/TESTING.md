# Testing Patterns

**Analysis Date:** 2026-03-07

## Test Framework

**Runner:**
- No test framework configured
- No test runner installed in any `package.json` (no vitest, jest, playwright, or testing-library)
- No test configuration files found (`vitest.config.*`, `jest.config.*`, `playwright.config.*`)

**Assertion Library:**
- None installed

**Run Commands:**
```bash
# No test commands exist. Current validation commands:
cd frontend && npm run check          # TypeScript + Svelte type checking only
cd cloudflare-worker && npm run typecheck  # TypeScript type checking only (tsc --noEmit)
```

## Test File Organization

**Location:**
- No test files exist in the project (all `*.test.*` and `*.spec.*` files found are inside `node_modules/`)

**Naming:**
- Not established

**Structure:**
- Not established

## Test Structure

**No tests exist.** This section documents the recommended approach for adding tests.

**Recommended framework:** Vitest (aligns with Vite-based frontend build and ESM-first approach)

**Recommended configuration location:**
- `frontend/vitest.config.ts` for frontend unit/integration tests
- `cloudflare-worker/vitest.config.ts` for Worker tests (using `@cloudflare/vitest-pool-workers`)

## Mocking

**Framework:** Not established

**What would need mocking:**
- `platform.env` object in SvelteKit server routes (contains `API_BASE_URL`, `API_SECRET_KEY`, `OPENAI_API_KEY`, `QDRANT_COLLECTION`)
- `fetch()` calls to external APIs (OpenAI, Qdrant, Neo4j, origin server)
- Cloudflare bindings in Worker tests (R2, D1, KV, Queues, AI)
- PostgreSQL `Pool` in MCP proxy and API backend
- Redis client in MCP proxy

**Key external dependencies to mock:**
- OpenAI Embeddings API (`https://api.openai.com/v1/embeddings`)
- OpenAI Chat Completions API (`https://api.openai.com/v1/chat/completions`)
- Qdrant vector search (via HTTP to origin or direct client)
- Neo4j Cypher queries (via HTTP to origin or bolt protocol)
- R2 object storage (Cloudflare binding)
- D1 SQLite cache (Cloudflare binding)

## Fixtures and Factories

**Test Data:**
- Not established
- Database contains 961K+ documents that could serve as integration test data
- Key fixture candidates: Document records, search results, entity graph structures, embedding vectors

**Location:**
- Not established

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
# Not configured
```

## Test Types

**Unit Tests:**
- Not present
- Priority targets for unit tests:
  - `frontend/src/lib/utils/index.ts` - Pure utility functions (`cn()`, `truncate()`, `formatFileSize()`, `entityColor()`)
  - `frontend/src/lib/features/chat/sse.ts` - SSE parser (async generator, pure logic)
  - `cloudflare-worker/src/index.ts` - `hashString()` utility function
  - `frontend/src/lib/features/search/stores.svelte.ts` - Store logic (search, pagination, filter state management)

**Integration Tests:**
- Not present
- Priority targets:
  - `frontend/src/routes/api/search/+server.ts` - Search API endpoint (fulltext, semantic, hybrid)
  - `frontend/src/routes/api/graph/+server.ts` - Graph traversal API
  - `frontend/src/routes/api/chat/+server.ts` - RAG chat endpoint with SSE streaming
  - `frontend/src/lib/server/db.ts` - Database query wrapper
  - `frontend/src/lib/server/neo4j.ts` - Neo4j client wrapper
  - `frontend/src/lib/server/qdrant.ts` - Qdrant client wrapper
  - `mcp-http-proxy/index.js` - MCP proxy routes and caching

**E2E Tests:**
- Not present
- No Playwright or Cypress configured
- Frontend deployed on Cloudflare Pages, would need Playwright for E2E

## Current Validation

**Type checking is the only automated validation:**

```bash
# Frontend: Svelte + TypeScript checking
cd frontend && npm run check
# Runs: svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
# Known issues: ~20 TypeScript errors remain (see MEMORY.md)

# Cloudflare Worker: TypeScript checking
cd cloudflare-worker && npm run typecheck
# Runs: tsc --noEmit
# Status: 0 errors

# No CI pipeline runs these checks automatically
```

**Manual validation:**
- Health check script: `scripts/05-health-check.sh`
- Processing status check: `scripts/check-processing-status.sh`
- MCP proxy health: `curl https://epstein-api.allfrontoffice.com/mcp/health`

## Recommended Test Setup

**Step 1: Install Vitest in frontend**
```bash
cd frontend
npm install -D vitest @testing-library/svelte jsdom
```

**Step 2: Create `frontend/vitest.config.ts`**
```typescript
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 3: Add test scripts to `frontend/package.json`**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 4: Priority test files to create**
- `frontend/src/lib/utils/index.test.ts` - Test `cn()`, `truncate()`, `formatFileSize()`, `entityColor()`
- `frontend/src/lib/features/chat/sse.test.ts` - Test `parseSSE()` async generator
- `frontend/src/lib/server/db.test.ts` - Test `query()` and `queryOne()` with mocked fetch
- `frontend/src/routes/api/search/+server.test.ts` - Test search endpoint with mocked dependencies

**For Cloudflare Worker tests:**
```bash
cd cloudflare-worker
npm install -D vitest @cloudflare/vitest-pool-workers
```

## CI/CD Pipeline

**Current state:** No CI/CD pipeline
- `.github/workflows/` directory exists but no workflow files detected
- No automated test runs on push/PR
- Deployment is manual: `ssh root@88.99.61.233 'cd /opt/app && git pull && docker compose up -d --build'`

---

*Testing analysis: 2026-03-07*
