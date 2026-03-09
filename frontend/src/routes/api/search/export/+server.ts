import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SearchResult, SearchMode, SearchFilters } from '$lib/types';
import { validateSearchQuery } from '@epstein/shared';
import {
	fulltextSearch,
	semanticSearch,
	hybridSearch,
	populateEntities
} from '$lib/server/search';

type ExportFormat = 'csv' | 'json';

interface ExportRequest {
	query: string;
	filters?: SearchFilters;
	mode: SearchMode;
	format: ExportFormat;
}

// Export limits: 5000 for fulltext/hybrid, 1000 for semantic (Qdrant constraints)
const EXPORT_LIMITS: Record<SearchMode, number> = {
	fulltext: 5000,
	hybrid: 5000,
	semantic: 1000
};

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env) {
		return json({ error: 'Platform unavailable in dev mode' }, { status: 500 });
	}

	const body = (await request.json()) as ExportRequest;
	const { query: rawQuery, filters = {}, mode, format } = body;

	if (!rawQuery?.trim()) {
		return json({ error: 'Query is required' }, { status: 400 });
	}

	if (!format || (format !== 'csv' && format !== 'json')) {
		return json({ error: 'Format must be "csv" or "json"' }, { status: 400 });
	}

	if (!mode || !EXPORT_LIMITS[mode]) {
		return json({ error: 'Mode must be "fulltext", "semantic", or "hybrid"' }, { status: 400 });
	}

	const searchQuery = validateSearchQuery(rawQuery);
	const limit = EXPORT_LIMITS[mode];

	try {
		let results: SearchResult[] = [];

		if (mode === 'fulltext') {
			const data = await fulltextSearch(platform, searchQuery, filters, limit, 0);
			results = data.results;
		} else if (mode === 'semantic') {
			const data = await semanticSearch(platform, searchQuery, filters, limit, 0);
			results = data.results;
		} else if (mode === 'hybrid') {
			const data = await hybridSearch(platform, searchQuery, filters, limit, 0);
			results = data.results;
		}

		// Populate entity badges
		if (results.length > 0) {
			results = await populateEntities(platform, results);
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const filename = `search-export-${timestamp}`;

		if (format === 'json') {
			return new Response(JSON.stringify(results, null, 2), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Content-Disposition': `attachment; filename="${filename}.json"`
				}
			});
		}

		// CSV format
		const csv = resultsToCSV(results);
		return new Response(csv, {
			status: 200,
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}.csv"`
			}
		});
	} catch (error) {
		console.error('Export error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};

/**
 * Convert search results to RFC 4180 CSV with UTF-8 BOM for Excel compatibility.
 */
function resultsToCSV(results: SearchResult[]): string {
	const BOM = '\uFEFF';
	const headers = ['filename', 'source', 'doc_type', 'date', 'score', 'snippet', 'entities'];
	const rows = results.map((r) => {
		const entityNames = r.entities.map((e) => e.name).join('; ');
		const snippet = stripHtmlTags(r.snippet);
		return [
			escapeCSV(r.filename),
			escapeCSV(r.source),
			escapeCSV(r.doc_type ?? ''),
			escapeCSV(r.date ?? ''),
			String(r.score),
			escapeCSV(snippet),
			escapeCSV(entityNames)
		].join(',');
	});

	return BOM + headers.join(',') + '\n' + rows.join('\n');
}

/**
 * Escape a CSV field per RFC 4180:
 * Wrap in double quotes if field contains comma, double-quote, or newline.
 * Double any internal quotes.
 */
function escapeCSV(field: string): string {
	if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
		return '"' + field.replace(/"/g, '""') + '"';
	}
	return field;
}

/**
 * Strip HTML tags from snippet text (e.g., <mark> tags from ts_headline).
 */
function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]*>/g, '');
}
