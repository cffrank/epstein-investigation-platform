import { CLAUDE_MODELS, createAnthropicClient } from "$lib/server/anthropic";
import { query } from "$lib/server/db";
import { executeTool, toolDefinitions } from "$lib/server/tools";
import type Anthropic from "@anthropic-ai/sdk";
import type { RequestHandler } from "./$types";

const MAX_TOOL_ITERATIONS = 5;

function buildSystemPrompt(entityName: string): string {
	return `You are an expert investigative journalist writing a comprehensive biographical profile based on the Epstein document corpus.

Your task: Write a detailed, factual biography of ${entityName} based ONLY on information found in the document corpus. Use your tools to search for relevant documents and entity connections.

Structure your biography with these sections:
1. Overview — who this person is and their relevance to the investigation
2. Key Connections — relationships to other entities found in documents
3. Document Evidence — what the corpus reveals about this person
4. Timeline of Involvement — chronological summary of documented events

CRITICAL RULES:
- Every claim MUST be supported by documents you retrieve. Do not make claims from general knowledge.
- If you cannot find sufficient documents, say so explicitly.
- Use neutral, factual language. Present evidence without editorializing.
- Aim for 500-1000 words.`;
}

export const POST: RequestHandler = async ({ params, request, platform }) => {
	if (!platform?.env) {
		return new Response(JSON.stringify({ error: "Platform not available" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}

	const { id } = params;
	if (!id || !/^\d+$/.test(id)) {
		return new Response(JSON.stringify({ error: "Invalid entity ID" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const body = (await request.json()) as { name?: string };
		const entityName = body.name?.trim();
		if (!entityName) {
			return new Response(JSON.stringify({ error: "Entity name is required" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const anthropic = createAnthropicClient(platform);
		const modelId = CLAUDE_MODELS["sonnet-4.6"];

		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		const writeSSE = async (event: string, data: unknown) => {
			await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
		};

		// Stream processing in background
		(async () => {
			let fullText = "";
			try {
				const systemPrompt = buildSystemPrompt(entityName);
				let currentMessages: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: `Write a comprehensive biography of ${entityName} based on the document corpus. Search for relevant documents and entity connections.`,
					},
				];

				let iterations = 0;

				while (iterations < MAX_TOOL_ITERATIONS) {
					iterations++;

					const stream = anthropic.messages.stream({
						model: modelId,
						max_tokens: 4096,
						system: systemPrompt,
						tools: toolDefinitions,
						messages: currentMessages,
					});

					for await (const event of stream) {
						switch (event.type) {
							case "content_block_start": {
								if (event.content_block.type === "tool_use") {
									await writeSSE("tool_call", {
										id: event.content_block.id,
										name: event.content_block.name,
									});
								}
								break;
							}
							case "content_block_delta": {
								if (event.delta.type === "text_delta") {
									fullText += event.delta.text;
									await writeSSE("text_delta", { text: event.delta.text });
								} else if (event.delta.type === "citations_delta") {
									await writeSSE("citations_delta", {
										citation: (event.delta as unknown as { citation: unknown }).citation,
									});
								}
								break;
							}
						}
					}

					const finalMessage = await stream.finalMessage();

					if (finalMessage.stop_reason !== "tool_use") {
						break;
					}

					const toolUseBlocks = finalMessage.content.filter(
						(block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
					);

					if (toolUseBlocks.length === 0) break;

					const toolResults = await Promise.all(
						toolUseBlocks.map(async (block) => {
							const result = await executeTool(block.name, block.input, platform);
							return { block, result };
						}),
					);

					for (const { block, result } of toolResults) {
						const resultCount = Array.isArray(result)
							? result.filter((r) => "type" in r && r.type === "search_result").length
							: 0;
						await writeSSE("tool_result", {
							id: block.id,
							name: block.name,
							status: "complete",
							resultCount,
						});
					}

					const toolResultMessages: Anthropic.Messages.ToolResultBlockParam[] = toolResults.map(
						({ block, result }) => ({
							type: "tool_result" as const,
							tool_use_id: block.id,
							content: result,
						}),
					);

					currentMessages = [
						...currentMessages,
						{ role: "assistant" as const, content: finalMessage.content },
						{ role: "user" as const, content: toolResultMessages },
					];
				}

				// Cache biography in PostgreSQL
				let cached = false;
				try {
					await query(
						platform,
						`UPDATE entities SET biography = $1, biography_generated_at = NOW(), biography_model = $2
						 WHERE canonical_name ILIKE $3`,
						[fullText, "claude-sonnet-4-6", entityName],
					);
					cached = true;
				} catch {
					// Entity may not exist in PostgreSQL entities table
					cached = false;
				}

				await writeSSE("done", { model: modelId, cached });
			} catch (err) {
				console.error("Biography stream error:", err);
				const message = err instanceof Error ? err.message : "Unknown error";
				try {
					await writeSSE("error", { message });
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
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				"X-Accel-Buffering": "no",
				Connection: "keep-alive",
			},
		});
	} catch (err) {
		console.error("Biography API error:", err);
		return new Response(
			JSON.stringify({
				error: err instanceof Error ? err.message : "Unknown error",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
};
