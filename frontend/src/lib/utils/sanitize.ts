import DOMPurify from 'isomorphic-dompurify';
import {
	SEARCH_SNIPPET_SANITIZE_CONFIG,
	CHAT_CONTENT_SANITIZE_CONFIG,
	DOCUMENT_TEXT_SANITIZE_CONFIG
} from '@epstein/shared';

/**
 * Sanitize search result snippets. Only allows <mark> tags for highlighting.
 */
export function sanitizeSearchSnippet(html: string): string {
	return DOMPurify.sanitize(html, SEARCH_SNIPPET_SANITIZE_CONFIG);
}

/**
 * Sanitize chat message content. Allows common formatting tags.
 */
export function sanitizeChatContent(html: string): string {
	return DOMPurify.sanitize(html, CHAT_CONTENT_SANITIZE_CONFIG);
}

/**
 * Sanitize document text display. Allows mark and span for highlighting.
 */
export function sanitizeDocumentText(html: string): string {
	return DOMPurify.sanitize(html, DOCUMENT_TEXT_SANITIZE_CONFIG);
}
