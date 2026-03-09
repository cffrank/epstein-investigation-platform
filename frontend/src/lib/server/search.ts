import { query as dbQuery } from '$lib/server/db';
import { qdrantClient } from '$lib/server/qdrant';
import type { SearchResult, SearchFilters, EntityRef, EntityType } from '$lib/types';

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
	person: 'Person',
	organization: 'Organization',
	location: 'Location'
};

function applyFilters(
	conditions: string[],
	params: unknown[],
	filters: SearchFilters,
	startIndex: number
): number {
	let paramIndex = startIndex;

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

	if (filters.entityIds?.length) {
		conditions.push(`id IN (
			SELECT de.document_id FROM document_entities de
			WHERE de.entity_id = ANY($${paramIndex})
			GROUP BY de.document_id
			HAVING COUNT(DISTINCT de.entity_id) = ${filters.entityIds.length}
		)`);
		params.push(filters.entityIds);
		paramIndex++;
	}

	return paramIndex;
}

export async function fulltextSearch(
	platform: App.Platform,
	searchQuery: string,
	filters: SearchFilters,
	limit: number,
	offset: number
) {
	const conditions: string[] = ["search_vector @@ plainto_tsquery('english', $1)"];
	const params: unknown[] = [searchQuery];
	let paramIndex = applyFilters(conditions, params, filters, 2);

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

export async function semanticSearch(
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

	// Search Qdrant -- fetch 3x when entity filters are active to compensate for post-filtering
	const qdrant = qdrantClient(platform);
	const qdrantLimit = filters.entityIds?.length ? (limit + offset) * 3 : limit + offset;
	const searchResults = await qdrant.search(embedding, {
		limit: qdrantLimit,
		with_payload: true
	});

	// Extract doc IDs and fetch metadata from PostgreSQL
	const docIds = searchResults
		.slice(offset, offset + limit)
		.map((r) => (r.payload.document_id || r.payload.doc_id) as string);

	if (docIds.length === 0) {
		return { results: [], total: searchResults.length };
	}

	const conditions: string[] = ['id = ANY($1)'];
	const params: unknown[] = [docIds];
	applyFilters(conditions, params, filters, 2);

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
	const scoreMap = new Map(
		searchResults.map((r) => [r.payload.document_id || r.payload.doc_id, r.score])
	);

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

export async function hybridSearch(
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

/**
 * Batch-fetch entities for a set of search results and attach them as badges.
 * Replaces the hardcoded `entities: []` on each result.
 */
export async function populateEntities(
	platform: App.Platform,
	results: SearchResult[]
): Promise<SearchResult[]> {
	const docIds = results.map((r) => r.id);

	const entityRows = await dbQuery<{
		document_id: string;
		id: string;
		name: string;
		type: string;
	}>(
		platform,
		`SELECT de.document_id, e.id, e.canonical_name as name, e.entity_type as type
		FROM document_entities de
		JOIN entities e ON e.id = de.entity_id
		WHERE de.document_id = ANY($1)
		ORDER BY de.mention_count DESC`,
		[docIds]
	);

	// Group entities by document_id
	const entityMap = new Map<string, EntityRef[]>();
	for (const row of entityRows) {
		const refs = entityMap.get(row.document_id) ?? [];
		refs.push({
			id: row.id,
			name: row.name,
			type: ENTITY_TYPE_MAP[row.type.toLowerCase()] ?? 'Person'
		});
		entityMap.set(row.document_id, refs);
	}

	return results.map((r) => ({
		...r,
		entities: entityMap.get(r.id) ?? []
	}));
}
