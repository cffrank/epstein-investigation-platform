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
	import ExportButton from '$lib/features/search/components/ExportButton.svelte';
	import { saveSavedSearch } from '$lib/features/search/saved-searches';
	import { Search, Bookmark, Check, X } from '@lucide/svelte';
	import type { SearchMode, SearchFilters, SavedSearch } from '$lib/types';

	let searchInput = $state('');
	let showSaveInput = $state(false);
	let saveNameInput = $state('');
	let saveSuccess = $state(false);
	let savedSearchRefreshKey = $state(0);
	let activeSavedSearch = $state<SavedSearch | null>(null);

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
		activeSavedSearch = null;
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

	async function handleFilterChange(filters: SearchFilters) {
		searchStore.setFilters(filters);
		if (searchStore.query) {
			await searchStore.performSearch();
			updateURL();
		}
	}

	async function handleEntityAdd(entity: import('$lib/types').EntityRef) {
		searchStore.addEntityFilter(entity);
		if (searchStore.query) {
			await searchStore.performSearch();
			updateURL();
		}
	}

	async function handleEntityRemove(entityId: string) {
		searchStore.removeEntityFilter(entityId);
		if (searchStore.query) {
			await searchStore.performSearch();
			updateURL();
		}
	}

	async function handleLoadSavedSearch(saved: SavedSearch) {
		searchStore.setQuery(saved.query);
		searchStore.setMode(saved.mode);
		searchStore.selectedEntities = [];
		searchStore.setFilters(saved.filters);
		searchInput = saved.query;
		activeSavedSearch = saved;
		await searchStore.performSearch();
		updateURL();
	}

	function handleSaveSearch() {
		showSaveInput = true;
		saveNameInput = searchStore.query.slice(0, 30);
	}

	function confirmSaveSearch() {
		if (!saveNameInput.trim()) return;

		const saved: SavedSearch = {
			id: crypto.randomUUID(),
			name: saveNameInput.trim(),
			query: searchStore.query,
			mode: searchStore.mode,
			filters: { ...searchStore.filters },
			createdAt: new Date().toISOString()
		};

		saveSavedSearch(saved);
		showSaveInput = false;
		saveNameInput = '';
		saveSuccess = true;
		savedSearchRefreshKey++;

		setTimeout(() => {
			saveSuccess = false;
		}, 2000);
	}

	function cancelSaveSearch() {
		showSaveInput = false;
		saveNameInput = '';
	}

	function clearSavedSearch() {
		activeSavedSearch = null;
		searchStore.setQuery('');
		searchStore.clearEntityFilters();
		searchStore.setFilters({});
		searchInput = '';
		searchStore.results = [];
		searchStore.total = 0;
		updateURL();
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}

	function handleSaveKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			confirmSaveSearch();
		} else if (event.key === 'Escape') {
			cancelSaveSearch();
		}
	}

	function buildFilterSummary(): string {
		const parts: string[] = [];
		if (searchStore.filters.entityIds?.length) {
			parts.push(`${searchStore.filters.entityIds.length} entity filter${searchStore.filters.entityIds.length > 1 ? 's' : ''}`);
		}
		if (searchStore.filters.sources?.length) {
			parts.push(`${searchStore.filters.sources.length} source${searchStore.filters.sources.length > 1 ? 's' : ''}`);
		}
		if (searchStore.filters.classifications?.length) {
			parts.push(searchStore.filters.classifications.join(', '));
		}
		if (searchStore.filters.dateRange) {
			parts.push(`${searchStore.filters.dateRange[0]} to ${searchStore.filters.dateRange[1]}`);
		}
		return parts.length > 0 ? parts.join(', ') : '';
	}
</script>

<div class="flex h-full">
	<FilterSidebar
		sources={searchStore.filters.sources}
		docTypes={searchStore.filters.docTypes}
		classifications={searchStore.filters.classifications}
		dateRange={searchStore.filters.dateRange}
		selectedEntities={searchStore.selectedEntities}
		{savedSearchRefreshKey}
		onFilterChange={handleFilterChange}
		onEntityAdd={handleEntityAdd}
		onEntityRemove={handleEntityRemove}
		onLoadSavedSearch={handleLoadSavedSearch}
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

			<!-- Active Saved Search Banner -->
			{#if activeSavedSearch}
				<div class="mb-4 px-4 py-2 bg-accent rounded-md flex items-center justify-between">
					<div class="text-sm">
						<span class="font-medium">Saved search: {activeSavedSearch.name}</span>
						{#if buildFilterSummary()}
							<span class="text-muted-foreground ml-2">({buildFilterSummary()})</span>
						{/if}
					</div>
					<Button variant="ghost" size="sm" onclick={clearSavedSearch}>
						<X class="h-4 w-4 mr-1" />
						Clear
					</Button>
				</div>
			{/if}

			<!-- Results Count + Action Bar -->
			{#if searchStore.query && !searchStore.loading}
				<div class="mb-4 flex items-center justify-between">
					<div class="text-sm text-muted-foreground">
						Found {searchStore.total.toLocaleString()} results
						{#if searchStore.total > searchStore.limit}
							(showing {((searchStore.page - 1) * searchStore.limit) + 1}-{Math.min(searchStore.page * searchStore.limit, searchStore.total)})
						{/if}
					</div>

					<div class="flex items-center gap-2">
						{#if showSaveInput}
							<div class="flex items-center gap-1">
								<Input
									type="text"
									placeholder="Search name..."
									bind:value={saveNameInput}
									onkeydown={handleSaveKeyPress}
									class="h-8 w-48 text-sm"
								/>
								<Button variant="ghost" size="sm" onclick={confirmSaveSearch}>
									<Check class="h-4 w-4" />
								</Button>
								<Button variant="ghost" size="sm" onclick={cancelSaveSearch}>
									<X class="h-4 w-4" />
								</Button>
							</div>
						{:else if saveSuccess}
							<span class="text-sm text-green-500 flex items-center gap-1">
								<Check class="h-4 w-4" />
								Saved
							</span>
						{:else}
							<Button variant="outline" size="sm" onclick={handleSaveSearch}>
								<Bookmark class="h-4 w-4 mr-1" />
								Save search
							</Button>
						{/if}

						<ExportButton
							query={searchStore.query}
							mode={searchStore.mode}
							filters={searchStore.filters}
							disabled={!searchStore.hasResults}
						/>
					</div>
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
