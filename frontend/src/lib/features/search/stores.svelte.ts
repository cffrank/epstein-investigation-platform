import type { SearchResult, SearchMode, SearchResponse, SearchFilters } from '$lib/types';

class SearchStore {
	query = $state('');
	mode = $state<SearchMode>('hybrid');
	results = $state<SearchResult[]>([]);
	total = $state(0);
	loading = $state(false);
	error = $state<string | null>(null);
	page = $state(1);
	limit = $state(20);
	filters = $state<SearchFilters>({});

	async performSearch() {
		if (!this.query.trim()) {
			this.results = [];
			this.total = 0;
			return;
		}

		this.loading = true;
		this.error = null;

		try {
			const response = await fetch('/api/search', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					query: this.query,
					filters: this.filters,
					mode: this.mode,
					page: this.page,
					limit: this.limit
				})
			});

			if (!response.ok) {
				throw new Error(`Search failed: ${response.statusText}`);
			}

			const data = (await response.json()) as SearchResponse;
			this.results = data.results;
			this.total = data.total;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Search failed';
			this.results = [];
			this.total = 0;
		} finally {
			this.loading = false;
		}
	}

	setQuery(q: string) {
		this.query = q;
		this.page = 1; // Reset to first page on new query
	}

	setMode(m: SearchMode) {
		this.mode = m;
		this.page = 1;
	}

	setPage(p: number) {
		this.page = p;
	}

	setFilters(f: SearchFilters) {
		this.filters = f;
		this.page = 1;
	}

	get totalPages() {
		return Math.ceil(this.total / this.limit);
	}

	get hasResults() {
		return this.results.length > 0;
	}

	get hasMore() {
		return this.page < this.totalPages;
	}
}

export const searchStore = new SearchStore();
