import type { RequestHandler } from '@sveltejs/kit';
import { createAnthropicClient, CLAUDE_MODELS, DEFAULT_MODEL } from '$lib/server/anthropic';
import type { ModelKey } from '$lib/types';
import { toolDefinitions, executeTool } from '$lib/server/tools';
import type Anthropic from '@anthropic-ai/sdk';

interface ChatRequest {
	messages: Array<{ role: string; content: string }>;
	model?: ModelKey;
}

const SYSTEM_PROMPT = `You are an AI investigation assistant analyzing the Epstein document corpus — over 960,000 documents including court filings, depositions, flight logs, correspondence, and financial records.

Your tools give you direct access to search the documents, find entities, and traverse the knowledge graph. USE THEM PROACTIVELY — do not answer from memory. Every factual claim must be supported by documents you retrieved.

Available tools:
- search_documents: Full-text search across the document corpus
- semantic_search: Find conceptually similar documents using vector embeddings
- get_entity_profile: Look up people, organizations, and locations in the knowledge graph
- graph_query: Traverse relationships between entities
- find_connections: Discover paths between two entities

When you retrieve documents, your citations will be automatically generated from the search results. Always provide specific, evidence-based answers grounded in the documents you find.

If you cannot find relevant documents for a claim, explicitly state that the information is not supported by the corpus.`;

const MAX_CONTEXT_MESSAGES = 6;
const MAX_TOOL_ITERATIONS = 5;

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env) {
		return new Response(JSON.stringify({ error: 'Platform not available' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const body = (await request.json()) as ChatRequest;
		const { messages } = body;

		if (!messages || messages.length === 0) {
			return new Response(JSON.stringify({ error: 'No messages provided' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Resolve model
		const modelKey = body.model && body.model in CLAUDE_MODELS ? body.model : DEFAULT_MODEL;
		const modelId = CLAUDE_MODELS[modelKey];

		// Create Anthropic client via AI Gateway
		const anthropic = createAnthropicClient(platform);

		// Apply sliding window (SEC-10): first message + last (N-1) messages
		let contextMessages = messages;
		if (messages.length > MAX_CONTEXT_MESSAGES) {
			contextMessages = [messages[0], ...messages.slice(-(MAX_CONTEXT_MESSAGES - 1))];
		}

		// Convert to Anthropic message format
		const anthropicMessages: Anthropic.Messages.MessageParam[] = contextMessages
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => ({
				role: m.role as 'user' | 'assistant',
				content: m.content,
			}));

		// Ensure messages alternate user/assistant (Anthropic requirement)
		// and start with a user message
		if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
			return new Response(JSON.stringify({ error: 'Messages must start with a user message' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Create SSE stream
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		const writeSSE = async (event: string, data: unknown) => {
			await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
		};

		// Stream processing in background
		(async () => {
			try {
				let currentMessages = [...anthropicMessages];
				let iterations = 0;

				while (iterations < MAX_TOOL_ITERATIONS) {
					iterations++;

					const stream = anthropic.messages.stream({
						model: modelId,
						max_tokens: 4096,
						system: SYSTEM_PROMPT,
						tools: toolDefinitions,
						messages: currentMessages,
					});

					// Track tool use blocks for execution after stream
					const toolUseAccumulator = new Map<
						number,
						{ id: string; name: string; inputJson: string }
					>();

					for await (const event of stream) {
						switch (event.type) {
							case 'content_block_start': {
								if (event.content_block.type === 'tool_use') {
									toolUseAccumulator.set(event.index, {
										id: event.content_block.id,
										name: event.content_block.name,
										inputJson: '',
									});
									await writeSSE('tool_call', {
										id: event.content_block.id,
										name: event.content_block.name,
									});
								}
								break;
							}
							case 'content_block_delta': {
								if (event.delta.type === 'text_delta') {
									await writeSSE('text_delta', { text: event.delta.text });
								} else if (event.delta.type === 'input_json_delta') {
									// Accumulate tool input JSON
									const acc = toolUseAccumulator.get(event.index);
									if (acc) {
										acc.inputJson += event.delta.partial_json;
									}
								} else if (event.delta.type === 'citations_delta') {
									await writeSSE('citations_delta', {
										citation: (event.delta as unknown as { citation: unknown }).citation,
									});
								}
								break;
							}
						}
					}

					const finalMessage = await stream.finalMessage();

					if (finalMessage.stop_reason !== 'tool_use') {
						// No more tools to execute — we're done
						break;
					}

					// Extract tool_use blocks from the final message
					const toolUseBlocks = finalMessage.content.filter(
						(block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
					);

					if (toolUseBlocks.length === 0) break;

					// Execute all tools in parallel
					const toolResults = await Promise.all(
						toolUseBlocks.map(async (block) => {
							const result = await executeTool(block.name, block.input, platform);
							return { block, result };
						})
					);

					// Notify client of tool results
					for (const { block, result } of toolResults) {
						const resultCount = Array.isArray(result)
							? result.filter((r) => 'type' in r && r.type === 'search_result').length
							: 0;
						await writeSSE('tool_result', {
							id: block.id,
							name: block.name,
							status: 'complete',
							resultCount,
						});
					}

					// Build messages for next iteration
					const toolResultMessages: Anthropic.Messages.ToolResultBlockParam[] =
						toolResults.map(({ block, result }) => ({
							type: 'tool_result' as const,
							tool_use_id: block.id,
							content: result,
						}));

					currentMessages = [
						...currentMessages,
						{ role: 'assistant' as const, content: finalMessage.content },
						{ role: 'user' as const, content: toolResultMessages },
					];
				}

				await writeSSE('done', { model: modelId });
			} catch (error) {
				console.error('Stream error:', error);
				const message = error instanceof Error ? error.message : 'Unknown error';
				try {
					await writeSSE('error', { message });
				} catch {
					// Writer may be closed
				}
			} finally {
				try {
					await writer.close();
				} catch {
					// Already closed
				}
			}
		})();

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				'X-Accel-Buffering': 'no',
				Connection: 'keep-alive',
			},
		});
	} catch (error) {
		console.error('Chat API error:', error);
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
