---
phase: 01-security-and-foundation
plan: 01
subsystem: infra
tags: [monorepo, typescript, vitest, biome, query-builders, auth]

requires:
  - phase: none
    provides: "First plan in phase"
provides:
  - "@epstein/shared package with query builders, auth guards, validation, types"
  - "Root npm workspace configuration"
  - "Biome lint/format configuration"
affects: [01-02, 01-03, 01-04, phase-2]

tech-stack:
  added: [vitest, biome, hono]
  patterns: [monorepo-workspaces, parameterized-queries, fail-closed-auth, tdd]

key-files:
  created:
    - "package.json"
    - "biome.json"
    - "packages/shared/src/index.ts"
    - "packages/shared/src/query-builders/sql.ts"
    - "packages/shared/src/query-builders/cypher.ts"
    - "packages/shared/src/auth/guards.ts"
    - "packages/shared/src/validation/sanitize.ts"
    - "packages/shared/src/types/index.ts"
  modified: []

key-decisions:
  - "Used npm workspaces (not pnpm) for monorepo since existing packages use npm"
  - "Shared package exports TypeScript source directly (no build step needed for workspace consumers)"
  - "DOMPurify configs exported as objects, not DOMPurify calls (DOM dependency stays in frontend)"
  - "Cypher allowlisted types joined into query string after validation (safe since they come from our Set, not user input)"

patterns-established:
  - "Parameterized SQL: all queries built via functions returning { text, values }"
  - "Cypher allowlisting: relationship types and node labels validated against Set before use"
  - "Fail-closed auth: guards throw on empty key, refuse to create insecure middleware"
  - "TDD: tests written before implementation, 48 tests covering all modules"

requirements-completed: [SEC-12]

duration: 8min
completed: 2026-03-07
---

# Phase 1 Plan 01: Monorepo + @epstein/shared Summary

**npm workspace monorepo with @epstein/shared package exporting parameterized SQL/Cypher query builders, fail-closed Hono auth guards, DOMPurify sanitization configs, and shared TypeScript types -- 48 tests passing**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files created:** 11

## Accomplishments
- Root npm workspace config linking frontend, cloudflare-worker, mcp-http-proxy, and packages/*
- Biome linter/formatter config (tabs, line width 100, recommended rules)
- @epstein/shared package with full TDD coverage (48 tests)
- Parameterized SQL query builders (fulltext search, capped count, stats, entity list)
- Cypher query builders with allowlist validation and depth clamping
- Fail-closed auth guards for Hono (API key + Cloudflare Access)
- Input validation and DOMPurify config objects

## Task Commits

1. **Task 1: Monorepo scaffold** - `b42a3d4` (chore)
2. **Task 2 RED: Tests** - `412b3cf` (test)
3. **Task 2 GREEN: Implementation** - `2675dc2` (feat)

## Files Created/Modified
- `package.json` - Root workspace config
- `biome.json` - Biome lint/format config
- `packages/shared/package.json` - @epstein/shared package config
- `packages/shared/tsconfig.json` - TypeScript config
- `packages/shared/vitest.config.ts` - Test runner config
- `packages/shared/src/index.ts` - Barrel export
- `packages/shared/src/types/index.ts` - Shared TypeScript types
- `packages/shared/src/query-builders/sql.ts` - Parameterized SQL builders
- `packages/shared/src/query-builders/cypher.ts` - Cypher builders with allowlist
- `packages/shared/src/auth/guards.ts` - Fail-closed auth middleware
- `packages/shared/src/validation/sanitize.ts` - DOMPurify configs and input validation

## Decisions Made
- Used npm workspaces for consistency with existing npm-based packages
- Shared package exports TypeScript source directly (consumers resolve via workspace)
- DOMPurify config objects only in shared; actual DOMPurify calls in frontend

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- @epstein/shared ready for import by Plans 02, 03, and 04
- All query builders tested and typed
- Auth guards ready for integration into frontend hooks, MCP proxy, and API backend

---
*Phase: 01-security-and-foundation*
*Completed: 2026-03-07*
