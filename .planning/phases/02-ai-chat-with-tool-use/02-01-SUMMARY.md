---
phase: 02-ai-chat-with-tool-use
plan: 01
status: complete
commit: 3fc179f
---

# Plan 01 Summary: Anthropic SDK + Investigation Tools

## What was done
- Installed `@anthropic-ai/sdk@0.78.0` via pnpm
- Created Anthropic client factory (`frontend/src/lib/server/anthropic.ts`) routing through Cloudflare AI Gateway
- Defined model map: haiku-4.5, sonnet-4.6 (default), opus-4.6
- Implemented 5 investigation tools with `search_result` content blocks for native citations:
  - `search_documents` — PostgreSQL full-text search with `plainto_tsquery` and `ts_headline`
  - `semantic_search` — Qdrant vector similarity with embedding fallback chain
  - `get_entity_profile` — Neo4j entity lookup with parameterized Cypher
  - `graph_query` — Neo4j traversal with configurable depth and relationship filters
  - `find_connections` — Neo4j shortest path between two entities
- Created tool registry with `executeTool()` dispatcher (graceful errors, never throws)
- Added `ToolCall`, `NativeCitation`, `ModelKey` types to shared types
- Added `ANTHROPIC_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` to Platform.env interface

## Key decisions
- Used Anthropic Search Results API (`search_result` blocks) instead of `[doc:UUID]` regex for zero-hallucination native citations
- All Neo4j queries use parameterized Cypher (CR-002 security requirement)
- Tool results capped at 1500 chars per document excerpt to stay within context limits
