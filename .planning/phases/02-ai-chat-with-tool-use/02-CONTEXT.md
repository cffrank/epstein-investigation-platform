# Phase 2: AI Chat with Tool Use - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace OpenAI chat (gpt-4o-mini) with Claude-powered investigation assistant via Anthropic SDK routed through Cloudflare AI Gateway. Claude autonomously calls five tools (search_documents, semantic_search, get_entity_profile, graph_query, find_connections) to query PostgreSQL, Qdrant, and Neo4j during conversation. Every factual claim cites specific documents. Context stays bounded with sliding window.

Requirements: CHAT-01 through CHAT-11.

</domain>

<decisions>
## Implementation Decisions

### Tool Call Visibility
- Collapsible panels showing tool name + brief status while running (e.g., "Searching documents for 'flight logs'...")
- Animated loading state with pulsing indicator while tool runs, updates in-place with results when done
- After response completes, panels collapse to one-line summaries (e.g., "Searched 23 documents") -- click to expand full input/output
- Claude can call multiple tools in parallel in one turn -- all execute simultaneously, results fed back together

### Citation Approach
- Tool-based citations: tools return document IDs with results, system prompt instructs Claude to cite using `[doc:UUID]` format
- Frontend parses `[doc:UUID]` markers and renders as superscript numbered badges (like Wikipedia footnotes)
- Hover on badge shows document name, click opens document viewer at `/documents/{id}`
- Citations scoped per-message -- numbers reset each message, each message has its own source list
- Citation panel shows: filename, source badge, excerpt, similarity score (scores visible to user)
- Impossible to hallucinate citations to documents not retrieved by tools

### Model Selector
- Dropdown in chat page header showing current model name
- Three model options: Haiku 4.5 (fast/cheap), Sonnet 4.6 (default, good for most), Opus 4.6 (deep analysis, slower)
- Each option shows brief hint: "Fast · Simple lookups", "Fast · Good for most", "Deep analysis · Slower"
- Selection persists in localStorage across page reloads and new conversations
- Model change takes effect on next message (not mid-conversation)

### AI Disclaimer
- Subtle muted text footer below each assistant message
- Context-aware wording:
  - With citations: "AI-generated · verify claims against source documents"
  - Without citations: "AI-generated · may contain errors · no sources cited"
- Stronger warning when no sources cited to flag unsupported claims

### Claude's Discretion
- Exact system prompt wording for investigation context and citation instructions
- Tool input schemas and parameter design for the five tools
- How to handle tool errors gracefully in the stream
- SSE event format for tool call/result/delta lifecycle
- Exact loading animation implementation
- How to handle connection pool pressure from parallel tool calls (pool at ~90/100)
- Whether to pre-fetch embeddings or let Claude decide when to use semantic search

</decisions>

<specifics>
## Specific Ideas

- Tool panels should feel like ChatGPT's browsing/code interpreter indicators -- informative but not overwhelming
- Citation badges should be superscript numbered (not inline chips) to preserve text flow
- Model dropdown should look clean in the header -- not a settings page, just a quick selector
- The disclaimer should nudge investigators to click citations and verify, not just be legal boilerplate
- Cloudflare Pages may buffer SSE -- monitor after Anthropic SDK switch (flagged concern from Phase 1)
- All Anthropic API calls must route through Cloudflare AI Gateway (standing decision)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/lib/features/chat/sse.ts`: Async generator SSE parser -- extend with new event types (tool_call, tool_result)
- `frontend/src/lib/features/chat/stores.svelte.ts`: Chat store with messages/citations/streaming state -- add tool call state
- `frontend/src/lib/features/chat/components/ChatMessage.svelte`: Message renderer with citation badge regex -- update regex for `[doc:UUID]` format
- `frontend/src/lib/features/chat/components/CitationPanel.svelte`: Citation panel with click-through links -- keep pattern, update data source
- `frontend/src/lib/features/chat/components/ChatInput.svelte`: Input component with Cmd+Enter -- no changes needed
- `frontend/src/routes/api/chat/+server.ts`: Chat API route -- major rewrite (OpenAI -> Anthropic SDK, add tool loop)
- `frontend/src/lib/server/db.ts`: PostgreSQL proxy client -- reuse for search_documents tool
- `frontend/src/lib/server/qdrant.ts`: Qdrant proxy client -- reuse for semantic_search tool
- `frontend/src/lib/server/neo4j.ts`: Neo4j proxy client -- reuse for get_entity_profile, graph_query, find_connections tools
- `frontend/src/lib/utils/sanitize.ts`: DOMPurify sanitization -- reuse for all AI content

### Established Patterns
- Hono for all backend HTTP -- consistent framework
- Svelte 5 runes ($state, $derived) for reactive chat store -- extend, don't replace
- Feature-sliced directory structure -- add tool-related components under features/chat/
- SSE streaming with TransformStream -- same pattern, different event types
- `requireAuth` middleware -- apply to chat API route
- Sliding window context management (6 messages) -- already implemented (SEC-10)

### Integration Points
- `frontend/src/routes/api/chat/+server.ts` -- main rewrite target
- `frontend/src/routes/(app)/chat/+page.svelte` -- add model selector to header, update message rendering
- `frontend/src/lib/features/chat/stores.svelte.ts` -- add tool call state tracking
- `frontend/src/lib/features/chat/sse.ts` -- add tool_call and tool_result event handling
- `frontend/src/app.d.ts` -- add ANTHROPIC_API_KEY to platform env types
- MCP HTTP Proxy -- tool implementations call through existing proxy clients
- Cloudflare AI Gateway -- route Anthropic SDK calls through gateway

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 02-ai-chat-with-tool-use*
*Context gathered: 2026-03-08*
