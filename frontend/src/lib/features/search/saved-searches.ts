import type { SavedSearch } from '$lib/types';

const STORAGE_KEY = 'epstein-saved-searches';
const MAX_SAVED = 100;

export function loadSavedSearches(): SavedSearch[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as SavedSearch[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function saveSavedSearch(search: SavedSearch): SavedSearch[] {
	const searches = loadSavedSearches();
	// Prepend new search (most recent first)
	searches.unshift(search);
	// Enforce max limit
	if (searches.length > MAX_SAVED) {
		searches.length = MAX_SAVED;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
	return searches;
}

export function deleteSavedSearch(id: string): SavedSearch[] {
	const searches = loadSavedSearches().filter((s) => s.id !== id);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
	return searches;
}
