import { query } from "$lib/server/db";
import { qdrantClient } from "$lib/server/qdrant";
import type Anthropic from "@anthropic-ai/sdk";

export const semanticSearchTool: Anthropic.Messages.Tool = {
	name: "semantic_search",
	description:
		"Search documents using semantic similarity. Finds conceptually related content even without exact keyword matches. Best for finding documents about a topic or concept.",
	input_schema: {
		type: "object" as const,
		properties: {
			query: {
				type: "string",
				description: "Natural language description of what to search for.",
			},
			limit: {
				type: "number",
				description: "Maximum number of results to return. Default 8, max 20.",
			},
		},
		required: ["query"],
	},
};

interface QdrantPayload {
	document_id: string;
	doc_id?: string;
	text?: string;
	text_preview?: string;
}

interface DocumentMeta {
	id: string;
	filename: string;
	source: string;
}

export async function executeSemanticSearch(
	input: { query: string; limit?: number },
	platform: App.Platform,
): Promise<Anthropic.Messages.ToolResultBlockParam["content"]> {
	const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
	const env = platform.env as { API_BASE_URL: string; API_SECRET_KEY: string };

	// Generate embedding for the query via backend API
	let embedding: number[];
	try {
		const embeddingResponse = await fetch(`${env.API_BASE_URL}/api/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": env.API_SECRET_KEY,
			},
			body: JSON.stringify({ text: input.query }),
		});

		if (!embeddingResponse.ok) {
			// Fallback: try the Cloudflare Worker AI embedding endpoint
			const workerResponse = await fetch(`${env.API_BASE_URL}/ai/embedding`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": env.API_SECRET_KEY,
				},
				body: JSON.stringify({ text: input.query }),
			});

			if (!workerResponse.ok) {
				return [
					{
						type: "text" as const,
						text: "Unable to generate embedding for semantic search. The embedding service is unavailable.",
					},
				];
			}

			const workerData = (await workerResponse.json()) as { embedding: number[] };
			embedding = workerData.embedding;
		} else {
			const embeddingData = (await embeddingResponse.json()) as { embedding: number[] };
			embedding = embeddingData.embedding;
		}
	} catch {
		return [
			{
				type: "text" as const,
				text: "Failed to connect to the embedding service for semantic search.",
			},
		];
	}

	// Search Qdrant
	const qdrant = qdrantClient(platform);
	const searchResults = await qdrant.search(embedding, { limit, with_payload: true });

	if (searchResults.length === 0) {
		return [
			{
				type: "text" as const,
				text: `No semantically similar documents found for "${input.query}".`,
			},
		];
	}

	// Get document metadata from PostgreSQL
	const docIds = [
		...new Set(
			searchResults.map((r) => {
				const p = r.payload as unknown as QdrantPayload;
				return p.document_id || p.doc_id;
			}),
		),
	];

	const documents = await query<DocumentMeta>(
		platform,
		"SELECT id, filename, source FROM documents WHERE id = ANY($1)",
		[docIds],
	);
	const docMap = new Map(documents.map((d) => [d.id, d]));

	return searchResults.map((result) => {
		const payload = result.payload as unknown as QdrantPayload;
		const docId = payload.document_id || payload.doc_id || "";
		const doc = docMap.get(docId);
		const text = (payload.text_preview || payload.text || "No text available").slice(0, 1500);

		return {
			type: "search_result" as const,
			source: `/documents/${docId}`,
			title: doc?.filename || "Unknown Document",
			content: [
				{
					type: "text" as const,
					text: `[Similarity: ${result.score.toFixed(3)}] ${text}`,
				},
			],
			citations: { enabled: true },
		};
	});
}
