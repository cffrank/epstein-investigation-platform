import { json, type RequestHandler } from '@sveltejs/kit';
import { qdrantClient } from '$lib/server/qdrant';
import { query } from '$lib/server/db';
import type { Citation } from '$lib/types';

interface ChatRequest {
	messages: Array<{ role: string; content: string }>;
}

interface QdrantPayload {
	doc_id: string;
	chunk_index: number;
	text: string;
}

interface DocumentRow {
	id: string;
	filename: string;
	source: string;
	created_at: string;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env) {
		return json({ error: 'Platform not available' }, { status: 500 });
	}

	try {
		const body = (await request.json()) as ChatRequest;
		const { messages } = body;

		if (!messages || messages.length === 0) {
			return json({ error: 'No messages provided' }, { status: 400 });
		}

		const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
		if (!lastUserMessage) {
			return json({ error: 'No user message found' }, { status: 400 });
		}

		// Generate embedding for the user query
		const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${platform.env.OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'text-embedding-3-small',
				input: lastUserMessage.content
			})
		});

		if (!embeddingResponse.ok) {
			throw new Error(`OpenAI embedding failed: ${embeddingResponse.status}`);
		}

		const embeddingData = await embeddingResponse.json();
		const embedding = embeddingData.data[0].embedding as number[];

		// Search Qdrant for relevant chunks
		const qdrant = qdrantClient(platform);
		const searchResults = await qdrant.search(embedding, { limit: 8, with_payload: true });

		// Extract document IDs and fetch metadata
		const docIds = [
			...new Set(searchResults.map((r) => (r.payload as unknown as QdrantPayload).doc_id))
		];

		const documents = await query<DocumentRow>(
			platform,
			`SELECT id, filename, source, created_at FROM documents WHERE id = ANY($1)`,
			[docIds]
		);

		const docMap = new Map(documents.map((d) => [d.id, d]));

		// Build citations
		const citationsData: Citation[] = searchResults.map((result, index) => {
			const payload = result.payload as unknown as QdrantPayload;
			const doc = docMap.get(payload.doc_id);
			return {
				index: index + 1,
				document_id: payload.doc_id,
				filename: doc?.filename || 'Unknown',
				source: doc?.source || 'Unknown',
				excerpt: payload.text.slice(0, 200),
				score: result.score
			};
		});

		// Build context for system prompt
		const contextChunks = searchResults.map((result, index) => {
			const payload = result.payload as unknown as QdrantPayload;
			return `[${index + 1}] ${payload.text}`;
		});

		const systemPrompt = `You are an AI assistant helping to analyze documents from the Epstein investigation platform. Use the following context from the document corpus to answer the user's question. Cite your sources using the citation numbers in square brackets (e.g., [1], [2]).

Context:
${contextChunks.join('\n\n')}

Answer the question based on the context provided. Always cite your sources using the citation numbers.`;

		// Build messages for OpenAI
		const apiMessages = [
			{ role: 'system', content: systemPrompt },
			...messages.slice(0, -1),
			{ role: 'user', content: lastUserMessage.content }
		];

		// Stream response from OpenAI
		const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${platform.env.OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: apiMessages,
				stream: true
			})
		});

		if (!chatResponse.ok) {
			throw new Error(`OpenAI chat failed: ${chatResponse.status}`);
		}

		if (!chatResponse.body) {
			throw new Error('No response body from OpenAI');
		}

		// Create SSE stream using TransformStream for Cloudflare compatibility
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		// Stream processing in background
		(async () => {
			try {
				// Send citations first
				await writer.write(
					encoder.encode(
						`event: citations\ndata: ${JSON.stringify(citationsData)}\n\n`
					)
				);

				const reader = chatResponse.body!.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.trim() || line === 'data: [DONE]') continue;
						if (!line.startsWith('data: ')) continue;

						const data = line.slice(6);
						try {
							const parsed = JSON.parse(data);
							const delta = parsed.choices?.[0]?.delta;
							if (delta?.content) {
								await writer.write(
									encoder.encode(
										`event: delta\ndata: ${JSON.stringify({ content: delta.content })}\n\n`
									)
								);
							}
						} catch (e) {
							// Skip parsing errors
							continue;
						}
					}
				}

				await writer.write(encoder.encode(`event: done\ndata: {}\n\n`));
			} catch (error) {
				console.error('Stream error:', error);
			} finally {
				await writer.close();
			}
		})();

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	} catch (error) {
		console.error('Chat API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
