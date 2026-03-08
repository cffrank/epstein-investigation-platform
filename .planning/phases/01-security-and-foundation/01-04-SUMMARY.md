# Plan 01-04: Tests + CI/CD Pipeline

## Status: COMPLETE

## What Was Done

### Task 1: Frontend Vitest (21 tests)
- Created `frontend/vitest.config.ts` with `$lib` and `$app` aliases
- Added `"test": "vitest run"` to `frontend/package.json`
- Wrote 3 test files:
  - `hooks.server.test.ts` (5 tests) - auth guard enforcement, 401 on missing header, /api/health bypass
  - `sse.test.ts` (5 tests) - SSE parser, partial chunk buffering, event type parsing
  - `sanitize.test.ts` (11 tests) - DOMPurify sanitization for search snippets, chat content, document text

### Task 2: Cloudflare Worker Vitest (5 tests)
- Installed `@cloudflare/vitest-pool-workers` and `vitest`
- Created `cloudflare-worker/vitest.config.ts` with wrangler.toml binding and test API_SECRET_KEY
- Wrote `cloudflare-worker/src/index.test.ts` (5 tests):
  - GET /health returns 200 with status ok
  - POST /search without query returns 400
  - POST /process/batch without X-API-Key returns 401
  - GET /documents/nonexistent returns 404
  - GET /nonexistent-route returns 404

### Task 3: CI/CD Pipeline + TypeScript
- Created `.github/workflows/ci.yml` with 3 jobs:
  - **test-and-lint**: Vitest (all workspaces), svelte-check, tsc --noEmit, Biome check, build, npm audit
  - **deploy-frontend**: Cloudflare Pages via wrangler-action (main only, after test-and-lint)
  - **deploy-backend**: Hetzner SSH deploy via appleboy/ssh-action (main only, after test-and-lint)
- Frontend TypeScript: 0 errors (was already clean, no fixes needed)

## Test Summary

| Workspace | Tests | Status |
|-----------|-------|--------|
| packages/shared | 48 | PASS |
| frontend | 21 | PASS |
| cloudflare-worker | 5 | PASS |
| **Total** | **74** | **ALL PASS** |

## Requirements Satisfied

- **SEC-14**: CI/CD pipeline blocks merge on test/lint/type-check/build failure
- **SEC-15**: Test infrastructure with critical-path tests across all workspaces
- **SEC-16**: Zero frontend TypeScript errors (svelte-check passes clean)

## Deviations

- Plan expected 20 frontend TS errors to fix; actual count was 0 (already clean)
- npm audit step uses `|| true` to not block on known vulnerabilities in dev dependencies
