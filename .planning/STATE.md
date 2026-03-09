# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-07)

**Core value:** An investigator can search, connect, and analyze 1.5M documents to discover relationships and patterns impossible to find manually.
**Current focus:** Phase 4 -- Faceted Search and Export

## Current Position

Phase: 3 of 7 (Entity Dossier Pages)
Plan: 4 of 4 in current phase
Status: Phase Complete
Last activity: 2026-03-08 -- Phase 3 complete (all 4 plans executed)

Progress: [████████████████████████] 43%

## Performance Metrics

**Velocity:**
- Total plans completed: 4 (Phase 3)
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 3 | 4 | - | - |

**Recent Trend:**
- Last 5 plans: 03-01, 03-02, 03-03, 03-04
- Trend: N/A

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Security fixes before Phase 2 features (open critical vulns must close before adding attack surface)
- Critical + High code review findings only (medium/low addressed incrementally)
- Foundation-only test infrastructure (vitest + critical paths, not full coverage)
- AI Gateway mandatory for all Anthropic API calls
- Claude model configurable (default Sonnet 4.6, option for Opus)
- Entity notes stored in entity_notes table (not investigation_notes which has different schema)
- Biography cached in entities.biography column with biography_generated_at timestamp
- Neo4j internal IDs used as entity references in entity_notes.entity_id (text column, not FK)

### Pending Todos

None yet.

### Blockers/Concerns

- Neo4j GDS memory behavior untested at 88K nodes / 917K edges (Phase 5 concern)
- Cloudflare Pages SSE buffering with Anthropic SDK unvalidated (monitor in production)
- Connection pool at ~90/100 -- tool use adds bursty queries (monitor in production)
- Timeline tab mostly empty until Phase 6 date extraction pipeline runs

## Session Continuity

Last session: 2026-03-08
Stopped at: Phase 4 context gathered, ready for plan-phase
Resume file: .planning/phases/04-faceted-search-and-export/04-CONTEXT.md
