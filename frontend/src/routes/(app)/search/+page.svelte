<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { searchStore } from '$lib/features/search/stores.svelte';
	import SearchResults from '$lib/features/search/components/SearchResults.svelte';
	import Pagination from '$lib/features/search/components/Pagination.svelte';
	import FilterSidebar from '$lib/features/filters/components/FilterSidebar.svelte';
	import { Search } from '@lucide/svelte';
	import type { SearchMode } from '$lib/types';

	let searchInput = $state('');

	// Initialize from URL params
	onMount(() => {
		const urlParams = new URLSearchParams($page.url.search);
		const q = urlParams.get('q') || '';
		const mode = (urlParams.get('mode') as SearchMode) || 'hybrid';
		const pageNum = parseInt(urlParams.get('page') || '1', 10);

		searchStore.setQuery(q);
		searchStore.setMode(mode);
		searchStore.setPage(pageNum);
		searchInput = q;

		if (q) {
			searchStore.performSearch();
		}
	});

	// Sync state to URL
	function updateURL() {
		const params = new URLSearchParams();
		if (searchStore.query) params.set('q', searchStore.query);
		params.set('mode', searchStore.mode);
		params.set('page', searchStore.page.toString());

		goto(`?${params.toString()}`, { replaceState: true, noScroll: true });
	}

	async function handleSearch() {
		searchStore.setQuery(searchInput);
		await searchStore.performSearch();
		updateURL();
	}

	async function handleModeChange(mode: SearchMode) {
		searchStore.setMode(mode);
		if (searchStore.query) {
			await searchStore.performSearch();
			updateURL();
		}
	}

	async function handlePageChange(pageNum: number) {
		searchStore.setPage(pageNum);
		await searchStore.performSearch();
		updateURL();
	}

	async function handleFilterChange(filters: {
		sources?: string[];
		docTypes?: string[];
		dateRange?: [string, string];
	}) {
		searchStore.setFilters(filters);
		if (searchStore.query) {
			await searchStore.performSearch();
			updateURL();
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}
</script>

<div class="flex h-full">
	<FilterSidebar
		sources={searchStore.filters.sources}
		docTypes={searchStore.filters.docTypes}
		dateRange={searchStore.filters.dateRange}
		onFilterChange={handleFilterChange}
	/>

	<div class="flex-1 overflow-y-auto">
		<div class="max-w-5xl mx-auto p-6">
			<!-- Header -->
			<div class="mb-8">
				<h1 class="text-3xl font-bold mb-2">Search Documents</h1>
				<p class="text-muted-foreground">
					Full-text and semantic search across 1.47M documents
				</p>
			</div>

			<!-- Search Input -->
			<div class="mb-6">
				<div class="flex gap-2">
					<div class="relative flex-1">
						<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							type="text"
							placeholder="Search documents..."
							bind:value={searchInput}
							onkeypress={handleKeyPress}
							class="pl-10"
						/>
					</div>
					<Button onclick={handleSearch} disabled={searchStore.loading}>
						Search
					</Button>
				</div>
			</div>

			<!-- Search Mode Tabs -->
			<Tabs value={searchStore.mode} class="mb-6">
				<TabsList class="grid w-full grid-cols-3 max-w-md">
					<TabsTrigger value="fulltext" onclick={() => handleModeChange('fulltext')}>
						Full-text
					</TabsTrigger>
					<TabsTrigger value="semantic" onclick={() => handleModeChange('semantic')}>
						Semantic
					</TabsTrigger>
					<TabsTrigger value="hybrid" onclick={() => handleModeChange('hybrid')}>
						Hybrid
					</TabsTrigger>
				</TabsList>
			</Tabs>

			<!-- Results Count -->
			{#if searchStore.query && !searchStore.loading}
				<div class="mb-4 text-sm text-muted-foreground">
					Found {searchStore.total.toLocaleString()} results
					{#if searchStore.total > searchStore.limit}
						(showing {((searchStore.page - 1) * searchStore.limit) + 1}-{Math.min(searchStore.page * searchStore.limit, searchStore.total)})
					{/if}
				</div>
			{/if}

			<!-- Error Message -->
			{#if searchStore.error}
				<div class="mb-4 p-4 bg-destructive/10 text-destructive rounded-md">
					{searchStore.error}
				</div>
			{/if}

			<!-- Search Results -->
			<SearchResults results={searchStore.results} loading={searchStore.loading} />

			<!-- Pagination -->
			{#if searchStore.hasResults && !searchStore.loading}
				<Pagination
					currentPage={searchStore.page}
					totalPages={searchStore.totalPages}
					onPageChange={handlePageChange}
				/>
			{/if}
		</div>
	</div>
</div>
