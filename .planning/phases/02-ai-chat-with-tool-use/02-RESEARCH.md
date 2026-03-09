# Phase 2: AI Chat with Tool Use - Research

**Researched:** 2026-03-08
**Domain:** Anthropic Claude SDK with streaming tool use, Citations API, Cloudflare AI Gateway
**Confidence:** HIGH

## Summary

Phase 2 replaces the OpenAI-powered chat with Claude via the `@anthropic-ai/sdk`. The key discovery is Anthropic's **Search Results API** — a native citation mechanism specifically designed for RAG applications that returns tool results as `search_result` blocks with automatic citation generation. This eliminates the need for the `[doc:UUID]` regex-based citation approach in CONTEXT.md, replacing it with structured citation objects that Claude generates natively.

The implementation involves: (1) installing `@anthropic-ai/sdk` and routing through Cloudflare AI Gateway via `baseURL` override, (2) defining five tools that query PostgreSQL/Qdrant/Neo4j via existing proxy clients, (3) implementing a server-side tool execution loop that streams SSE events to the frontend, (4) tools return `search_result` blocks so Claude generates `citations_delta` SSE events with structured source references, and (5) the frontend renders citation badges and tool call indicators in the chat stream.

**Primary recommendation:** Use `search_result` content blocks in tool results (not `[doc:UUID]` markers) to get native Anthropic citations with automatic source attribution, zero hallucination risk on citation pointers, and output token savings on cited text.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Collapsible panels showing tool name + brief status while running (e.g., "Searching documents for 'flight logs'...")
- Animated loading state with pulsing indicator while tool runs, updates in-place with results when done
- After response completes, panels collapse to one-line summaries (e.g., "Searched 23 documents") -- click to expand full input/output
- Claude can call multiple tools in parallel in one turn -- all execute simultaneously, results fed back together
- Tool-based citations: tools return document IDs with results, system prompt instructs Claude to cite using `[doc:UUID]` format (SUPERSEDED by search_result API — see research below)
- Frontend parses `[doc:UUID]` markers and renders as superscript numbered badges (SUPERSEDED — native citation blocks from API)
- Hover on badge shows document name, click opens document viewer at `/documents/{id}`
- Citations scoped per-message -- numbers reset each message, each message has its own source list
- Citation panel shows: filename, source badge, excerpt, similarity score (scores visible to user)
- Impossible to hallucinate citations to documents not retrieved by tools
- Dropdown in chat page header showing current model name
- Three model options: Haiku 4.5 (fast/cheap), Sonnet 4.6 (default, good for most), Opus 4.6 (deep analysis, slower)
- Each option shows brief hint: "Fast · Simple lookups", "Fast · Good for most", "Deep analysis · Slower"
- Selection persists in localStorage across page reloads and new conversations
- Model change takes effect on next message (not mid-conversation)
- Subtle muted text footer below each assistant message
- Context-aware wording for disclaimers
- Stronger warning when no sources cited to flag unsupported claims

### Claude's Discretion
- Exact system prompt wording for investigation context and citation instructions
- Tool input schemas and parameter design for the five tools
- How to handle tool errors gracefully in the stream
- SSE event format for tool call/result/delta lifecycle
- Exact loading animation implementation
- How to handle connection pool pressure from parallel tool calls (pool at ~90/100)
- Whether to pre-fetch embeddings or let Claude decide when to use semantic search

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHAT-01 | Chat with Claude via Anthropic SDK routed through Cloudflare AI Gateway | `@anthropic-ai/sdk` with `baseURL` override to `https://gateway.ai.cloudflare.com/v1/{account_id}/internal-gateway/anthropic`. SDK supports Cloudflare Workers/Pages runtime. |
| CHAT-02 | Select Claude model (Haiku 4.5, Sonnet 4.6, Opus 4.6) in chat settings | Model IDs: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-6`. Pass model from frontend via request body, apply server-side. |
| CHAT-03 | search_documents tool queries PostgreSQL full-text search | Reuse existing `query()` from `$lib/server/db.ts`. Tool returns `search_result` blocks with document text for native citations. |
| CHAT-04 | semantic_search tool queries Qdrant vector similarity | Reuse existing `qdrantClient().search()`. Generate embeddings via Cloudflare Workers AI BGE-base or existing pipeline. Return `search_result` blocks. |
| CHAT-05 | get_entity_profile tool retrieves entity data from Neo4j | Reuse existing `neo4jClient().query()`. Cypher query for entity + relationships. Return as `search_result` for citable entity data. |
| CHAT-06 | graph_query tool traverses Neo4j relationships | Parameterized Cypher traversal via `neo4jClient()`. Format results as structured text in `search_result` blocks. |
| CHAT-07 | find_connections tool discovers paths between entities | Neo4j shortest path query via `neo4jClient()`. Return connection paths as `search_result` blocks. |
| CHAT-08 | Streaming SSE responses for text and tool calls | Anthropic SDK `messages.stream()` provides SSE events. Server transforms to custom SSE events: `tool_call`, `tool_result`, `text_delta`, `citations_delta`, `done`. |
| CHAT-09 | Inline document ID citations linking to document viewer | Use Anthropic `search_result` blocks in tool results → native `citations_delta` events in stream. Frontend renders citation badges linking to `/documents/{id}`. |
| CHAT-10 | Sliding window context (last 6 messages + current turn tools) | Already implemented (SEC-10). Preserve existing logic, extend to handle tool_use/tool_result message pairs. |
| CHAT-11 | AI disclaimer on generated content | Static muted footer per assistant message. Context-aware: with/without citations wording. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.78.0 | Claude API client with streaming + tool use + citations | Official Anthropic TypeScript SDK. Native `messages.stream()` for SSE. Tool use is GA. Search Results API for native citations. Works in Cloudflare Workers/Pages runtime. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (existing) `isomorphic-dompurify` | ^3.0.0 | Sanitize AI-generated HTML | Already in deps — reuse for citation badge rendering |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@anthropic-ai/sdk` | `@ai-sdk/anthropic` (Vercel AI SDK) | Adds unnecessary abstraction. React-oriented hooks irrelevant in SvelteKit. Existing SSE parser + Svelte stores work fine. |
| `@anthropic-ai/sdk` | Raw `fetch()` to Anthropic API | Possible but manual handling of tool loops, streaming events, and type safety. SDK is much more ergonomic. |
| Anthropic Search Results API | `[doc:UUID]` regex markers | Regex approach is fragile — Claude can hallucinate citation format. Search Results API guarantees valid citations with exact source text. |

**Installation:**
```bash
cd frontend && pnpm add @anthropic-ai/sdk
```

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── routes/api/chat/+server.ts          # Major rewrite — Anthropic SDK tool loop
├── lib/
│   ├── server/
│   │   ├── db.ts                       # Keep — reuse for search_documents tool
│   │   ├── qdrant.ts                   # Keep — reuse for semantic_search tool
│   │   ├── neo4j.ts                    # Keep — reuse for graph tools
│   │   ├── anthropic.ts               # NEW — Anthropic client singleton + AI Gateway config
│   │   └── tools/                      # NEW — tool definitions and handlers
│   │       ├── index.ts               # Tool registry (all 5 tools)
│   │       ├── search-documents.ts    # PostgreSQL full-text search tool
│   │       ├── semantic-search.ts     # Qdrant vector search tool
│   │       ├── get-entity-profile.ts  # Neo4j entity lookup tool
│   │       ├── graph-query.ts         # Neo4j traversal tool
│   │       └── find-connections.ts    # Neo4j path finding tool
│   ├── features/chat/
│   │   ├── sse.ts                     # Update — add tool_call, tool_result, citations_delta events
│   │   ├── stores.svelte.ts           # Update — add tool call state, per-message citations
│   │   └── components/
│   │       ├── ChatMessage.svelte     # Update — citation badges from native API, disclaimer
│   │       ├── CitationPanel.svelte   # Update — per-message citations, source URLs
│   │       ├── ChatInput.svelte       # Keep as-is
│   │       ├── ToolCallPanel.svelte   # NEW — collapsible tool call indicator
│   │       └── ModelSelector.svelte   # NEW — model dropdown
│   └── types/index.ts                 # Update — ToolCall, NativeCitation types
```

### Pattern 1: Server-Side Tool Execution Loop
**What:** The SvelteKit API route handles the entire tool loop server-side, streaming intermediate events to the client.
**When to use:** Always — tools access databases that require server-side credentials.
**Example:**
```typescript
// Simplified tool loop in +server.ts
const stream = anthropic.messages.stream({
  model: selectedModel,
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  tools: toolDefinitions,
  messages: boundedMessages,
});

// Stream events to client via SSE
for await (const event of stream) {
  if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    // Send tool_call event to frontend
    yield sseEvent('tool_call', { id: event.content_block.id, name: event.content_block.name });
  }
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    yield sseEvent('text_delta', { text: event.delta.text });
  }
  if (event.type === 'content_block_delta' && event.delta.type === 'citations_delta') {
    yield sseEvent('citations_delta', { citation: event.delta.citation });
  }
}

// If response has tool_use blocks, execute tools and continue
const finalMessage = await stream.finalMessage();
if (finalMessage.stop_reason === 'tool_use') {
  // Execute tools, get results as search_result blocks
  // Call Claude again with tool_results, stream that too
}
```

### Pattern 2: Search Result Blocks for Native Citations
**What:** Tool handlers return `search_result` content blocks instead of plain text, enabling Claude's native citation mechanism.
**When to use:** Any tool that retrieves citable content (documents, entities, graph data).
**Example:**
```typescript
// In search-documents.ts tool handler
function formatAsSearchResults(documents: DocumentRow[]): SearchResultBlock[] {
  return documents.map(doc => ({
    type: 'search_result' as const,
    source: `/documents/${doc.id}`,  // Used as citation source URL
    title: doc.filename,
    content: [{ type: 'text' as const, text: doc.text_content }],
    citations: { enabled: true }
  }));
}

// Return in tool_result message
{
  type: 'tool_result',
  tool_use_id: toolUseBlock.id,
  content: formatAsSearchResults(results)  // search_result blocks
}
```

### Pattern 3: SSE Event Protocol
**What:** Custom SSE events streamed from server to frontend for real-time UI updates.
**Events:**
```
event: tool_call
data: {"id": "toolu_xxx", "name": "search_documents", "input": {"query": "flight logs"}}

event: tool_status
data: {"id": "toolu_xxx", "status": "running", "message": "Searching 961K documents..."}

event: tool_result
data: {"id": "toolu_xxx", "status": "complete", "result_count": 23}

event: text_delta
data: {"text": "According to the flight logs, "}

event: citations_delta
data: {"citation": {"type": "char_location", "cited_text": "...", "source": "/documents/abc-123", "title": "flight-log-2005.pdf"}}

event: done
data: {"model": "claude-sonnet-4-6", "usage": {"input_tokens": 1234, "output_tokens": 567}}
```

### Anti-Patterns to Avoid
- **Client-side tool execution:** Never expose database credentials to the browser. All tool execution happens server-side.
- **Unbounded tool loops:** Cap tool loop iterations (max 5 rounds) to prevent runaway API costs.
- **Serializing entire documents in context:** Use text excerpts/chunks, not full document content. Each tool result should stay under ~2000 tokens.
- **Blocking on parallel tool calls:** When Claude returns multiple tool_use blocks, execute all tools in parallel with `Promise.all()`, not sequentially.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Citation extraction from AI responses | Regex-based `[doc:UUID]` parsing | Anthropic Search Results API + `citations_delta` events | Regex citations can be hallucinated. Native citations are guaranteed valid — the API extracts exact quoted text from provided sources. `cited_text` doesn't count toward output tokens (cost savings). |
| SSE stream parsing | Custom line-by-line parser | Existing `parseSSE()` async generator (extend it) | Already battle-tested. Just add new event types. |
| Embedding generation for semantic search | Custom embedding endpoint | Cloudflare Workers AI BGE-base-en-v1.5 via existing pipeline | 768-dim embeddings already stored in Qdrant. Use the same model for query embeddings. |
| Tool use loop management | Manual message array building | `@anthropic-ai/sdk` `messages.stream()` + manual loop | SDK handles serialization, type checking, and streaming. Manual loop needed for server-side tool execution but SDK simplifies the API calls. |

**Key insight:** The Anthropic Search Results API is the single biggest simplification. It turns a fragile regex-based citation system into a structured API where citations are impossible to hallucinate and come with free source text extraction.

## Common Pitfalls

### Pitfall 1: Cloudflare Pages SSE Buffering
**What goes wrong:** Cloudflare Pages may buffer SSE responses, causing chunks to arrive in bursts rather than token-by-token.
**Why it happens:** Edge caching and response buffering at the CDN layer.
**How to avoid:** Set `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers. Test early. If buffering persists, consider streaming through the Hetzner backend directly for chat (bypassing Pages for this route).
**Warning signs:** Tokens appear in chunks of 10-50 instead of 1-3 at a time.

### Pitfall 2: Connection Pool Exhaustion from Parallel Tool Calls
**What goes wrong:** Claude calls 3-5 tools simultaneously, each hitting PostgreSQL/Qdrant/Neo4j. With pool at ~90/100, this can exhaust connections.
**Why it happens:** Parallel tool execution multiplies concurrent connections per chat request.
**How to avoid:** (1) Execute tools via the MCP HTTP proxy which manages its own pool. (2) Limit parallel tool calls to 3 concurrent. (3) Use connection timeouts to release quickly. (4) Consider a semaphore pattern to queue excess tool calls.
**Warning signs:** 503 errors or connection timeouts during chat with multiple tool calls.

### Pitfall 3: Unbounded Context Growth with Tool Messages
**What goes wrong:** Each tool loop iteration adds assistant (tool_use) + user (tool_result) messages. After 3-4 rounds, context can exceed token limits.
**Why it happens:** Tool results include search_result blocks with document text, which can be large.
**How to avoid:** (1) Keep the sliding window at 6 human messages. (2) Summarize previous tool results in subsequent rounds. (3) Cap tool result text to ~1500 chars per document. (4) Max 5 tool loop iterations.
**Warning signs:** `max_tokens` errors or responses getting truncated.

### Pitfall 4: Streaming Interruption with Large Tool Use JSON
**What goes wrong:** Stream terminates without `message_stop` event when tool use blocks have large JSON payloads.
**Why it happens:** Known issue reported in Anthropic SDK (GitHub issue #842, November 2025).
**How to avoid:** (1) Keep tool input schemas simple with limited-size parameters. (2) Handle stream interruption gracefully — detect missing `message_stop` and recover. (3) Set reasonable timeouts on the stream reader.
**Warning signs:** Incomplete tool call data on the client, missing `done` event.

### Pitfall 5: Model Name Mismatch
**What goes wrong:** Using wrong model identifiers causes API errors.
**Why it happens:** Model names changed between versions (e.g., `claude-3-5-sonnet` vs `claude-sonnet-4-6`).
**How to avoid:** Use exact model IDs from API docs: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-6`.
**Warning signs:** 400 or 404 errors from Anthropic API.

## Code Examples

### Anthropic Client with Cloudflare AI Gateway
```typescript
// frontend/src/lib/server/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';

export function createAnthropicClient(platform: App.Platform) {
  const env = platform.env as {
    ANTHROPIC_API_KEY: string;
    CLOUDFLARE_ACCOUNT_ID: string;
  };

  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/internal-gateway/anthropic`,
  });
}
```

### Tool Definition Example
```typescript
// frontend/src/lib/server/tools/search-documents.ts
import type Anthropic from '@anthropic-ai/sdk';

export const searchDocumentsTool: Anthropic.Messages.Tool = {
  name: 'search_documents',
  description: 'Search the Epstein investigation document corpus using full-text search. Returns matching documents with excerpts.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text. Supports PostgreSQL full-text search operators.'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return. Default 10, max 25.'
      }
    },
    required: ['query']
  }
};

export async function executeSearchDocuments(
  input: { query: string; limit?: number },
  platform: App.Platform
): Promise<Anthropic.Messages.SearchResultBlockParam[]> {
  const { query } = await import('$lib/server/db');
  const results = await query(platform,
    `SELECT id, filename, source,
            ts_headline('english', COALESCE(metadata->>'text',''), plainto_tsquery('english', $1),
              'MaxWords=200, MinWords=50') as excerpt
     FROM documents
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
     LIMIT $2`,
    [input.query, Math.min(input.limit ?? 10, 25)]
  );

  return results.map(doc => ({
    type: 'search_result' as const,
    source: `/documents/${doc.id}`,
    title: doc.filename,
    content: [{ type: 'text' as const, text: doc.excerpt || 'No text available' }],
    citations: { enabled: true }
  }));
}
```

### Streaming SSE with Tool Loop
```typescript
// Simplified pattern for +server.ts
async function* chatStream(
  client: Anthropic,
  messages: Anthropic.Messages.MessageParam[],
  tools: Anthropic.Messages.Tool[],
  model: string,
  platform: App.Platform
): AsyncGenerator<string> {
  let currentMessages = [...messages];
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    let hasToolUse = false;
    const toolUseBlocks: Anthropic.Messages.ToolUseBlock[] = [];

    for await (const event of stream) {
      // Forward text deltas and citations to client
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          hasToolUse = true;
          yield `event: tool_call\ndata: ${JSON.stringify({
            id: event.content_block.id,
            name: event.content_block.name
          })}\n\n`;
        }
      }
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield `event: text_delta\ndata: ${JSON.stringify({ text: event.delta.text })}\n\n`;
        }
        if (event.delta.type === 'citations_delta') {
          yield `event: citations_delta\ndata: ${JSON.stringify({ citation: event.delta.citation })}\n\n`;
        }
      }
    }

    const finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason !== 'tool_use') break;

    // Execute tools and continue loop
    const toolResults = await executeTools(finalMessage.content, platform);
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults }
    ];

    // Notify client of tool results
    for (const result of toolResults) {
      yield `event: tool_result\ndata: ${JSON.stringify({
        id: result.tool_use_id,
        status: 'complete'
      })}\n\n`;
    }
  }

  yield `event: done\ndata: {}\n\n`;
}
```

### Frontend Citation Rendering from Native API
```typescript
// Citation from Anthropic API (citations_delta event)
interface NativeCitation {
  type: 'char_location' | 'page_location' | 'content_block_location';
  cited_text: string;
  document_index: number;
  document_title: string;
  source: string;  // This is our /documents/{id} URL
  start_char_index?: number;
  end_char_index?: number;
}

// Rendered as superscript badge linking to document viewer
// <sup><a href="/documents/{id}" class="citation-badge">[1]</a></sup>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `[doc:UUID]` regex citation markers in system prompt | Anthropic Search Results API with `search_result` blocks | Jan 2025 (Citations API), mid-2025 (Search Results) | Zero-hallucination citations, output token savings, structured citation objects |
| OpenAI `gpt-4o-mini` for chat | Claude Sonnet 4.6 / Opus 4.6 with native tool use | 2025 | Much better tool use quality, native streaming tool support |
| Pre-computed embeddings in chat context | Claude autonomously calls search tools | GA 2024 | Model decides when to search, what to query — more relevant results |
| OpenAI text-embedding-3-small | Keep BGE-base-en-v1.5 for Qdrant queries | N/A | Must match existing 768-dim embeddings in Qdrant. Use Cloudflare Workers AI for query embedding generation. |

**Deprecated/outdated:**
- `anthropic-version: 2023-06-01` still works but consider checking for newer version header
- `claude-3-5-sonnet-20241022` replaced by `claude-sonnet-4-6`

## Open Questions

1. **Cloudflare AI Gateway + Streaming Tool Use**
   - What we know: AI Gateway supports Anthropic SDK with `baseURL` override. Streaming works for basic text.
   - What's unclear: Whether `search_result` blocks and `citations_delta` events pass through correctly. Gateway may not understand these newer API features.
   - Recommendation: Test early in Plan 1 (backend setup). Fall back to direct Anthropic API if gateway strips citation events.

2. **Embedding Generation for semantic_search Tool**
   - What we know: Qdrant has 768-dim BGE-base-en-v1.5 embeddings. The existing pipeline uses Cloudflare Workers AI for batch embedding.
   - What's unclear: Whether the SvelteKit API route (Cloudflare Pages) can call Workers AI directly for query embedding, or needs to go through the backend API.
   - Recommendation: Route query embedding through the MCP HTTP proxy's existing embedding endpoint, or call the Cloudflare Worker's `/ai/embedding` endpoint.

3. **Connection Pool Pressure**
   - What we know: Pool at ~90/100. Each tool call hits a DB.
   - What's unclear: Actual concurrent usage patterns — single user means likely 1 chat at a time.
   - Recommendation: Monitor during testing. Since this is a single-user platform, pool exhaustion is unlikely but tools should use connection timeouts.

## Sources

### Primary (HIGH confidence)
- [Anthropic Citations API docs](https://platform.claude.com/docs/en/build-with-claude/citations) — Citations response format, streaming support, document types
- [Anthropic Search Results API docs](https://platform.claude.com/docs/en/build-with-claude/search-results) — search_result blocks in tool results, TypeScript examples
- [Cloudflare AI Gateway + Anthropic docs](https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/) — baseURL configuration, authentication headers
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — SDK version, API surface
- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) — Streaming examples, tool use patterns

### Secondary (MEDIUM confidence)
- [Anthropic SDK issue #842](https://github.com/anthropics/anthropic-sdk-typescript/issues/842) — Streaming interruption with tool use
- Existing codebase analysis — Current OpenAI-based chat implementation, proxy clients, SSE parser

### Tertiary (LOW confidence)
- [Cloudflare AI Gateway Aug 2025 refresh blog](https://blog.cloudflare.com/ai-gateway-aug-2025-refresh/) — General AI Gateway capabilities (not specific to Anthropic citations)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@anthropic-ai/sdk` is the only option, well-documented
- Architecture: HIGH — Tool loop pattern is well-established, search_result API has official TypeScript examples
- Pitfalls: MEDIUM — SSE buffering and connection pool concerns need runtime validation
- Citations approach: HIGH — Official Anthropic documentation with code examples for exact use case (RAG with tool results)

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable APIs, 30-day window)
