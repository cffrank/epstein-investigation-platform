/**
 * DOMPurify configuration for search result snippets.
 * Only allows <mark> tags for highlighting search matches.
 */
export const SEARCH_SNIPPET_SANITIZE_CONFIG = {
	ALLOWED_TAGS: ["mark"],
	ALLOWED_ATTR: [] as string[],
};

/**
 * DOMPurify configuration for chat content.
 * Allows common formatting tags used in markdown-rendered chat responses.
 */
export const CHAT_CONTENT_SANITIZE_CONFIG = {
	ALLOWED_TAGS: ["p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "a", "mark"],
	ALLOWED_ATTR: ["href", "class"],
};

/**
 * DOMPurify configuration for document text display.
 * Allows mark and span for highlighting and annotation.
 */
export const DOCUMENT_TEXT_SANITIZE_CONFIG = {
	ALLOWED_TAGS: ["mark", "span"],
	ALLOWED_ATTR: ["class"],
};

/**
 * Validate and sanitize a search query string.
 * Trims whitespace, rejects empty, caps at 500 chars.
 */
export function validateSearchQuery(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) {
		throw new Error("Search query cannot be empty");
	}
	return trimmed.slice(0, 500);
}

/**
 * Validate and coerce pagination parameters.
 * Ensures page and limit are positive integers, caps limit at 100.
 */
export function validatePaginationParams(
	page: unknown,
	limit: unknown,
): { page: number; limit: number } {
	let parsedPage = Number(page);
	let parsedLimit = Number(limit);

	if (Number.isNaN(parsedPage) || parsedPage < 1) {
		parsedPage = 1;
	} else {
		parsedPage = Math.floor(parsedPage);
	}

	if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
		if (limit === undefined || limit === null || Number.isNaN(parsedLimit)) {
			parsedLimit = 25;
		} else {
			parsedLimit = 1;
		}
	} else {
		parsedLimit = Math.min(100, Math.floor(parsedLimit));
	}

	return { page: parsedPage, limit: parsedLimit };
}
