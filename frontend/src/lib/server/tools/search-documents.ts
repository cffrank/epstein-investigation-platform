import type Anthropic from '@anthropic-ai/sdk';
import { query } from '$lib/server/db';

export const searchDocumentsTool: Anthropic.Messages.Tool = {
	name: 'search_documents',
	description:
		'Search the Epstein investigation document corpus using full-text search. Returns matching documents with highlighted excerpts. Use for keyword-based searches across 960K+ documents.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description: 'Search query text. Supports natural language queries.',
			},
			limit: {
				type: 'number',
				description: 'Maximum number of results to return. Default 10, max 25.',
			},
		},
		required: ['query'],
	},
};

interface SearchDocumentResult {
	id: string;
	filename: string;
	source: string;
	excerpt: string;
}

export async function executeSearchDocuments(
	input: { query: string; limit?: number },
	platform: App.Platform
): Promise<Anthropic.Messages.ToolResultBlockParam['content']> {
	const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);

	const results = await query<SearchDocumentResult>(
		platform,
		`SELECT id, filename, source,
			ts_headline('english', COALESCE(metadata->>'text',''),
				plainto_tsquery('english', $1),
				'MaxWords=200, MinWords=50') as excerpt
		FROM documents
		WHERE search_vector @@ plainto_tsquery('english', $1)
		ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
		LIMIT $2`,
		[input.query, limit]
	);

	if (results.length === 0) {
		return [
			{
				type: 'text' as const,
				text: `No documents found matching "${input.query}".`,
			},
		];
	}

	return results.map((doc) => ({
		type: 'search_result' as const,
		source: `/documents/${doc.id}`,
		title: doc.filename,
		content: [
			{
				type: 'text' as const,
				text: (doc.excerpt || 'No text available').slice(0, 1500),
			},
		],
		citations: { enabled: true },
	}));
}
