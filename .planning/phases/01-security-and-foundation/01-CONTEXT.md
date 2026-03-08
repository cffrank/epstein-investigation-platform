# Phase 1: Security and Foundation - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Close critical vulnerabilities (Cypher injection, XSS, auth bypass), fix performance bottlenecks (ILIKE scans, COUNT queries, hybrid search), establish test infrastructure with CI gates, resolve frontend TS errors, extract shared modules, and replace the raw SQL proxy. The platform ships on a secure, stable base before any Phase 2 features.

Requirements: SEC-01 through SEC-16.

</domain>

<decisions>
## Implementation Decisions

### CI/CD Pipeline
- Block merges/deploys on test failure — tests must pass before code ships
- Auto-deploy on merge to main — CI runs, if green, deploy frontend to Cloudflare Pages + SSH deploy backend to Hetzner
- CI checks: Vitest tests, TypeScript type checking (svelte-check + tsc --noEmit), Biome lint/format, build verification, npm audit
- Linter/formatter: Biome (already available globally, fast, single tool)
- GitHub Actions (existing workflow at `.github/workflows/deploy-frontend.yml` to extend)

### Test Foundation
- Critical paths only for Phase 1: SQL query builders, auth guards, SSE parser (~15-20 tests)
- Both frontend (Vitest) and Cloudflare Worker (@cloudflare/vitest-pool-workers) get test suites
- All tests use mocked dependencies (no live DB required in CI) — Claude's discretion on whether to add optional integration tests
- Policy: new code in future phases must include tests — CI enforced

### SQL Proxy Replacement (SEC-13)
- Replace raw SQL proxy with typed API endpoints (document search, stats, entity listing, etc.)
- Claude determines which specific endpoints are needed based on current frontend usage patterns
- Retain a read-only ad-hoc query endpoint behind API key auth on internal network only — for Claude Code and OpenClaw investigation queries
- Read-only PostgreSQL role for the ad-hoc endpoint (no write capability)

### Shared Module Strategy (SEC-12)
- Monorepo workspace package using npm workspaces
- Package at `packages/shared/` (or similar), imported as `@epstein/shared`
- Scope: all security modules — query builders + parameterization, auth guard logic, input validation/sanitization, shared TypeScript types
- Query builders directly address SEC-01 (Cypher injection) and SEC-07 (ILIKE replacement)
- Auth guards directly address SEC-04 (frontend auth) and CR-007 (fail-closed)

### TypeScript Migration
- Migrate MCP proxy (`mcp-http-proxy/index.js`, 302 lines) to TypeScript
- Migrate API backend (`cloudflare-worker/api-backend/index.js`, `fast-processor.js`) to TypeScript
- Both consume the shared package's TypeScript types directly
- Consistent toolchain across all packages

### Claude's Discretion
- Exact Biome configuration rules
- Which typed API endpoints to create (based on usage analysis)
- Mock vs integration test split decisions
- Order of security fix implementation within the phase
- DOMPurify configuration details
- Cypher allowlist implementation approach
- How to handle the 20 frontend TS errors (batch fix vs incremental)

</decisions>

<specifics>
## Specific Ideas

- CI should extend the existing GitHub Actions workflow at `.github/workflows/deploy-frontend.yml`
- Biome chosen because it's already referenced in global CLAUDE.md (`npx biome format --write` for CRLF)
- Read-only ad-hoc query endpoint preserves investigation flexibility while closing the security hole
- MCP proxy is small (302 lines) — quick TS migration win
- API backend has the most security-critical code — TS migration catches bugs at compile time

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/lib/server/db.ts`: PostgreSQL proxy client — refactor into shared package
- `frontend/src/lib/server/neo4j.ts`: Neo4j proxy client — refactor into shared package
- `frontend/src/lib/server/qdrant.ts`: Qdrant proxy client — refactor into shared package
- `frontend/src/lib/types/index.ts`: Shared TypeScript interfaces — move to shared package
- `frontend/src/lib/utils/index.ts`: Utility functions (cn, truncate, etc.) — test targets
- `frontend/src/lib/features/chat/sse.ts`: SSE parser — critical test target
- `.github/workflows/deploy-frontend.yml`: Existing CI workflow to extend

### Established Patterns
- Hono used across all backends (Worker, MCP proxy, API backend) — consistent HTTP framework
- `requireAuth` middleware pattern exists in MCP proxy and API backend — standardize in shared package
- `try/catch` with JSON error responses — consistent error handling to preserve
- Svelte 5 runes for state management — no changes needed
- Feature-sliced directory structure in frontend — maintain for new code

### Integration Points
- `config/nginx/conf.d/default.conf`: Routing rules need updating for new API endpoints
- `docker-compose.yml`: MCP proxy container needs rebuild after TS migration
- `frontend/src/hooks.server.ts`: Auth enforcement point (currently reads but doesn't block)
- `cloudflare-worker/api-backend/index.js:617-621`: Cypher blocklist to replace with allowlist
- `cloudflare-worker/api-backend/index.js:660-662`: Cypher injection point to fix
- Root `package.json`: Needs workspace configuration for monorepo

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-security-and-foundation*
*Context gathered: 2026-03-07*
