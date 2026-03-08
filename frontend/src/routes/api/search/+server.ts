import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query as dbQuery } from '$lib/server/db';
import { qdrantClient } from '$lib/server/qdrant';
import type { SearchResult, SearchMode } from '$lib/types';
import { validateSearchQuery, validatePaginationParams } from '@epstein/shared';

interface SearchFilters {
	dateRange?: [string, string];
	sources?: string[];
	docTypes?: string[];
	classifications?: string[];
}

interface SearchRequest {
	query: string;
	filters?: SearchFilters;
	mode: SearchMode;
	page?: number;
	limit?: number;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env) {
		return json({ error: 'Platform unavailable in dev mode' }, { status: 500 });
	}

	const body = (await request.json()) as SearchRequest;
	const { query: rawQuery, filters = {}, mode } = body;

	if (!rawQuery?.trim()) {
		return json({ results: [], total: 0, query: rawQuery, mode });
	}

	const searchQuery = validateSearchQuery(rawQuery);
	const { page, limit } = validatePaginationParams(body.page, body.limit);
	const offset = (page - 1) * limit;

	try {
		let results: SearchResult[] = [];
		let total = 0;

		if (mode === 'fulltext') {
			const data = await fulltextSearch(platform, searchQuery, filters, limit, offset);
			results = data.results;
			total = data.total;
		} else if (mode === 'semantic') {
			const data = await semanticSearch(platform, searchQuery, filters, limit, offset);
			results = data.results;
			total = data.total;
		} else if (mode === 'hybrid') {
			const data = await hybridSearch(platform, searchQuery, filters, limit, offset);
			results = data.results;
			total = data.total;
		}

		return json({ results, total, query: searchQuery, mode });
	} catch (error) {
		console.error('Search error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};

async function fulltextSearch(
	platform: App.Platform,
	searchQuery: string,
	filters: SearchFilters,
	limit: number,
	offset: number
) {
	const conditions: string[] = ["search_vector @@ plainto_tsquery('english', $1)"];
	const params: unknown[] = [searchQuery];
	let paramIndex = 2;

	if (filters.sources?.length) {
		conditions.push(`source = ANY($${paramIndex})`);
		params.push(filters.sources);
		paramIndex++;
	}

	if (filters.docTypes?.length) {
		conditions.push(`doc_type = ANY($${paramIndex})`);
		params.push(filters.docTypes);
		paramIndex++;
	}

	if (filters.classifications?.length) {
		conditions.push(`metadata->>'content_classification' = ANY($${paramIndex})`);
		params.push(filters.classifications);
		paramIndex++;
	}

	if (filters.dateRange) {
		conditions.push(`created_at >= $${paramIndex}`);
		params.push(filters.dateRange[0]);
		paramIndex++;
		conditions.push(`created_at <= $${paramIndex}`);
		params.push(filters.dateRange[1]);
		paramIndex++;
	}

	const whereClause = conditions.join(' AND ');

	// Capped count: LIMIT 10001 avoids scanning all 961K rows for pagination
	// Frontend displays "10,000+" when count equals 10001
	const countSql = `
		WITH capped AS (
			SELECT 1 FROM documents WHERE ${whereClause} LIMIT 10001
		)
		SELECT COUNT(*) as count FROM capped
	`;

	const searchSql = `
		SELECT
			id,
			filename,
			source,
			doc_type,
			created_at,
			ts_rank(search_vector, plainto_tsquery('english', $1)) as rank,
			ts_headline('english',
				COALESCE(metadata->>'text', ''),
				plainto_tsquery('english', $1),
				'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>'
			) as snippet
		FROM documents
		WHERE ${whereClause}
		ORDER BY rank DESC
		LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
	`;

	params.push(limit, offset);

	const [countResult, searchResults] = await Promise.all([
		dbQuery<{ count: string }>(platform, countSql, params.slice(0, -2)),
		dbQuery<{
			id: string;
			filename: string;
			source: string;
			doc_type: string | null;
			created_at: string;
			rank: number;
			snippet: string;
		}>(platform, searchSql, params)
	]);

	const total = parseInt(countResult[0]?.count || '0', 10);

	const results: SearchResult[] = searchResults.map((row) => ({
		id: row.id,
		filename: row.filename,
		source: row.source,
		doc_type: row.doc_type,
		snippet: row.snippet || '',
		score: row.rank,
		date: row.created_at,
		entities: []
	}));

	return { results, total };
}

async function semanticSearch(
	platform: App.Platform,
	searchQuery: string,
	filters: SearchFilters,
	limit: number,
	offset: number
) {
	// Generate embedding via OpenAI
	const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${(platform.env as { OPENAI_API_KEY: string }).OPENAI_API_KEY}`
		},
		body: JSON.stringify({
			model: 'text-embedding-3-small',
			input: searchQuery,
			dimensions: 1536
		})
	});

	if (!embeddingResponse.ok) {
		throw new Error(`OpenAI embedding failed: ${embeddingResponse.statusText}`);
	}

	const embeddingData = (await embeddingResponse.json()) as {
		data: Array<{ embedding: number[] }>;
	};
	const embedding = embeddingData.data[0].embedding;

	// Search Qdrant
	const qdrant = qdrantClient(platform);
	const searchResults = await qdrant.search(embedding, {
		limit: limit + offset,
		with_payload: true
	});

	// Extract doc IDs and fetch metadata from PostgreSQL
	const docIds = searchResults.slice(offset, offset + limit).map((r) => (r.payload.document_id || r.payload.doc_id) as string);

	if (docIds.length === 0) {
		return { results: [], total: searchResults.length };
	}

	const conditions: string[] = ['id = ANY($1)'];
	const params: unknown[] = [docIds];
	let paramIndex = 2;

	if (filters.sources?.length) {
		conditions.push(`source = ANY($${paramIndex})`);
		params.push(filters.sources);
		paramIndex++;
	}

	if (filters.docTypes?.length) {
		conditions.push(`doc_type = ANY($${paramIndex})`);
		params.push(filters.docTypes);
		paramIndex++;
	}

	if (filters.classifications?.length) {
		conditions.push(`metadata->>'content_classification' = ANY($${paramIndex})`);
		params.push(filters.classifications);
		paramIndex++;
	}

	if (filters.dateRange) {
		conditions.push(`created_at >= $${paramIndex}`);
		params.push(filters.dateRange[0]);
		paramIndex++;
		conditions.push(`created_at <= $${paramIndex}`);
		params.push(filters.dateRange[1]);
		paramIndex++;
	}

	const sql = `
		SELECT
			id,
			filename,
			source,
			doc_type,
			created_at,
			COALESCE(metadata->>'text', '') as text
		FROM documents
		WHERE ${conditions.join(' AND ')}
	`;

	const docs = await dbQuery<{
		id: string;
		filename: string;
		source: string;
		doc_type: string | null;
		created_at: string;
		text: string;
	}>(platform, sql, params);

	// Create a map for quick lookup
	const docMap = new Map(docs.map((d) => [d.id, d]));
	const scoreMap = new Map(searchResults.map((r) => [r.payload.document_id || r.payload.doc_id, r.score]));

	const results: SearchResult[] = docIds
		.map((docId): SearchResult | null => {
			const doc = docMap.get(docId);
			if (!doc) return null;

			const score = scoreMap.get(docId) || 0;
			const snippet = doc.text.slice(0, 300) + (doc.text.length > 300 ? '...' : '');

			return {
				id: doc.id,
				filename: doc.filename,
				source: doc.source,
				doc_type: doc.doc_type,
				snippet,
				score,
				date: doc.created_at,
				entities: []
			};
		})
		.filter((r): r is SearchResult => r !== null);

	return { results, total: searchResults.length };
}

async function hybridSearch(
	platform: App.Platform,
	searchQuery: string,
	filters: SearchFilters,
	limit: number,
	offset: number
) {
	// Run both searches in parallel
	const [fulltext, semantic] = await Promise.all([
		fulltextSearch(platform, searchQuery, filters, limit * 2, 0),
		semanticSearch(platform, searchQuery, filters, limit * 2, 0)
	]);

	// Reciprocal Rank Fusion (RRF) with k=60
	const k = 60;
	const scoreMap = new Map<string, { doc: SearchResult; rrfScore: number }>();

	// Process fulltext results
	fulltext.results.forEach((doc, index) => {
		const rrfScore = 1 / (k + index + 1);
		scoreMap.set(doc.id, { doc, rrfScore });
	});

	// Process semantic results and merge
	semantic.results.forEach((doc, index) => {
		const rrfScore = 1 / (k + index + 1);
		const existing = scoreMap.get(doc.id);

		if (existing) {
			// Combine scores for documents in both results
			existing.rrfScore += rrfScore;
		} else {
			scoreMap.set(doc.id, { doc, rrfScore });
		}
	});

	// Sort by combined RRF score
	const merged = Array.from(scoreMap.values())
		.sort((a, b) => b.rrfScore - a.rrfScore)
		.map((item) => ({
			...item.doc,
			score: item.rrfScore
		}));

	// Apply pagination
	const results = merged.slice(offset, offset + limit);
	const total = merged.length;

	return { results, total };
}
