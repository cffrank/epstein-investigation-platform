import type { SqlQuery } from "../types/index.js";

/**
 * Build a parameterized full-text search query using plainto_tsquery.
 * Never uses ILIKE - always uses the indexed search_vector column.
 */
export function buildFulltextSearchQuery(
	query: string,
	options: { limit?: number; offset?: number; source?: string } = {},
): SqlQuery {
	const trimmed = query.trim();
	if (!trimmed) {
		throw new Error("Search query cannot be empty");
	}

	const { limit = 25, offset = 0, source } = options;
	const values: unknown[] = [trimmed];
	let paramIndex = 2;

	let whereClause = `search_vector @@ plainto_tsquery('english', $1)`;

	if (source) {
		whereClause += ` AND source = $${paramIndex}`;
		values.push(source);
		paramIndex++;
	}

	const limitParam = `$${paramIndex}`;
	values.push(limit);
	paramIndex++;

	const offsetParam = `$${paramIndex}`;
	values.push(offset);

	const text = `SELECT id, filename, source, doc_type,
    ts_headline('english', COALESCE(extracted_text, ''), plainto_tsquery('english', $1),
      'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') AS snippet,
    ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
  FROM documents
  WHERE ${whereClause}
  ORDER BY score DESC
  LIMIT ${limitParam} OFFSET ${offsetParam}`;

	return { text, values };
}

/**
 * Build a capped count query using a CTE with LIMIT 10001.
 * Frontend shows "10,000+" when count equals 10001.
 */
export function buildCappedCountQuery(whereClause: string, params: unknown[]): SqlQuery {
	const text = `WITH capped AS (
    SELECT 1 FROM documents WHERE ${whereClause} LIMIT 10001
  )
  SELECT COUNT(*) AS count FROM capped`;

	return { text, values: [...params] };
}

/**
 * Build a query to get document processing statistics.
 */
export function buildDocumentStatsQuery(): SqlQuery {
	const text = `SELECT
    source,
    COUNT(*) AS total,
    COUNT(CASE WHEN extracted_text IS NOT NULL THEN 1 END) AS text_extracted,
    COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) AS indexed,
    COUNT(CASE WHEN embeddings_status = 'completed' THEN 1 END) AS embedded
  FROM documents
  GROUP BY source
  ORDER BY total DESC`;

	return { text, values: [] };
}

/**
 * Build a parameterized entity list query.
 */
export function buildEntityListQuery(
	options: { type?: string; limit?: number; offset?: number } = {},
): SqlQuery {
	const { type, limit = 25, offset = 0 } = options;
	const values: unknown[] = [];
	let paramIndex = 1;

	let whereClause = "";
	if (type) {
		whereClause = `WHERE type = $${paramIndex}`;
		values.push(type);
		paramIndex++;
	}

	values.push(limit);
	const limitParam = `$${paramIndex}`;
	paramIndex++;

	values.push(offset);
	const offsetParam = `$${paramIndex}`;

	const text = `SELECT id, name, type, document_count, properties
  FROM entities
  ${whereClause}
  ORDER BY document_count DESC
  LIMIT ${limitParam} OFFSET ${offsetParam}`;

	return { text, values };
}
