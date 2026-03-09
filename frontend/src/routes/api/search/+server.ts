import { fulltextSearch, hybridSearch, populateEntities, semanticSearch } from "$lib/server/search";
import type { SearchFilters, SearchMode, SearchResult } from "$lib/types";
import { validatePaginationParams, validateSearchQuery } from "@epstein/shared";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

interface SearchRequest {
	query: string;
	filters?: SearchFilters;
	mode: SearchMode;
	page?: number;
	limit?: number;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env) {
		return json({ error: "Platform unavailable in dev mode" }, { status: 500 });
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

		if (mode === "fulltext") {
			const data = await fulltextSearch(platform, searchQuery, filters, limit, offset);
			results = data.results;
			total = data.total;
		} else if (mode === "semantic") {
			const data = await semanticSearch(platform, searchQuery, filters, limit, offset);
			results = data.results;
			total = data.total;
		} else if (mode === "hybrid") {
			const data = await hybridSearch(platform, searchQuery, filters, limit, offset);
			results = data.results;
			total = data.total;
		}

		// Populate entity badges on results
		if (results.length > 0) {
			results = await populateEntities(platform, results);
		}

		return json({ results, total, query: searchQuery, mode });
	} catch (error) {
		console.error("Search error:", error);
		return json({ error: String(error) }, { status: 500 });
	}
};
