<script lang="ts">
	import type { EntityRef, SavedSearch, SearchFilters } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '$lib/components/ui/accordion';
	import { X } from '@lucide/svelte';
	import EntityAutocomplete from '$lib/features/search/components/EntityAutocomplete.svelte';
	import SavedSearches from '$lib/features/search/components/SavedSearches.svelte';

	interface Props {
		sources?: string[];
		docTypes?: string[];
		classifications?: string[];
		dateRange?: [string, string];
		selectedEntities?: EntityRef[];
		savedSearchRefreshKey?: number;
		onFilterChange: (filters: SearchFilters) => void;
		onEntityAdd: (entity: EntityRef) => void;
		onEntityRemove: (entityId: string) => void;
		onLoadSavedSearch: (saved: SavedSearch) => void;
	}

	let {
		sources = [],
		docTypes = [],
		classifications = [],
		dateRange,
		selectedEntities = [],
		savedSearchRefreshKey = 0,
		onFilterChange,
		onEntityAdd,
		onEntityRemove,
		onLoadSavedSearch
	}: Props = $props();

	// Common datasets from the system
	const availableSources = [
		'dataset_1',
		'dataset_2',
		'dataset_9',
		'dataset_10',
		'dataset_11',
		'epstein-docs',
		'epstein-docs-fulltext',
		'house-oversight-gdrive'
	];

	const availableDocTypes = [
		'Court Filing',
		'Legal Document',
		'Email',
		'Report',
		'Testimony',
		'Photo',
		'Other'
	];

	const availableClassifications = [
		'email',
		'deposition_transcript',
		'court_filing',
		'financial_record',
		'flight_log',
		'calendar_entry',
		'letter_correspondence',
		'legal_motion',
		'fbi_report',
		'photograph',
		'handwritten_note',
		'other'
	];

	// Date range presets
	const datePresets = [
		{ label: '1990s', start: '1990-01-01', end: '1999-12-31' },
		{ label: '2000s', start: '2000-01-01', end: '2009-12-31' },
		{ label: '2010s', start: '2010-01-01', end: '2019-12-31' },
		{ label: '2005', start: '2005-01-01', end: '2005-12-31' },
		{ label: '2006', start: '2006-01-01', end: '2006-12-31' },
		{ label: '2008', start: '2008-01-01', end: '2008-12-31' },
		{ label: '2019', start: '2019-01-01', end: '2019-12-31' }
	];

	let selectedSources = $state<Set<string>>(new Set(sources));
	let selectedDocTypes = $state<Set<string>>(new Set(docTypes));
	let selectedClassifications = $state<Set<string>>(new Set(classifications));
	let startDate = $state(dateRange?.[0] || '');
	let endDate = $state(dateRange?.[1] || '');

	function toggleSource(source: string) {
		if (selectedSources.has(source)) {
			selectedSources.delete(source);
		} else {
			selectedSources.add(source);
		}
		emitFilters();
	}

	function toggleDocType(type: string) {
		if (selectedDocTypes.has(type)) {
			selectedDocTypes.delete(type);
		} else {
			selectedDocTypes.add(type);
		}
		emitFilters();
	}

	function toggleClassification(classification: string) {
		if (selectedClassifications.has(classification)) {
			selectedClassifications.delete(classification);
		} else {
			selectedClassifications.add(classification);
		}
		emitFilters();
	}

	function updateDateRange() {
		emitFilters();
	}

	function applyDatePreset(preset: { start: string; end: string }) {
		startDate = preset.start;
		endDate = preset.end;
		emitFilters();
	}

	function emitFilters() {
		onFilterChange({
			sources: selectedSources.size > 0 ? Array.from(selectedSources) : undefined,
			docTypes: selectedDocTypes.size > 0 ? Array.from(selectedDocTypes) : undefined,
			classifications: selectedClassifications.size > 0 ? Array.from(selectedClassifications) : undefined,
			dateRange:
				startDate && endDate ? ([startDate, endDate] as [string, string]) : undefined,
			entityIds: selectedEntities.length > 0 ? selectedEntities.map((e) => e.id) : undefined
		});
	}

	function clearAll() {
		selectedSources.clear();
		selectedDocTypes.clear();
		selectedClassifications.clear();
		startDate = '';
		endDate = '';
		// Clear entity filters
		for (const entity of [...selectedEntities]) {
			onEntityRemove(entity.id);
		}
		emitFilters();
	}

	let hasActiveFilters = $derived(
		selectedSources.size > 0 ||
		selectedDocTypes.size > 0 ||
		selectedClassifications.size > 0 ||
		(startDate && endDate) ||
		selectedEntities.length > 0
	);
</script>

<aside class="w-64 border-r bg-background p-4 overflow-y-auto">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-lg font-semibold">Filters</h2>
		{#if hasActiveFilters}
			<Button variant="ghost" size="sm" onclick={clearAll}>
				<X class="h-4 w-4 mr-1" />
				Clear
			</Button>
		{/if}
	</div>

	<Separator class="mb-4" />

	<Accordion type="multiple" class="w-full" value={["sources"]}>
		<AccordionItem value="sources">
			<AccordionTrigger>Source Datasets</AccordionTrigger>
			<AccordionContent>
				<div class="space-y-2 pl-2">
					{#each availableSources as source}
						<label class="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedSources.has(source)}
								onchange={() => toggleSource(source)}
								class="rounded border-gray-300"
							/>
							<span class="text-sm">{source}</span>
						</label>
					{/each}
				</div>
			</AccordionContent>
		</AccordionItem>

		<AccordionItem value="docTypes">
			<AccordionTrigger>Document Types</AccordionTrigger>
			<AccordionContent>
				<div class="space-y-2 pl-2">
					{#each availableDocTypes as type}
						<label class="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedDocTypes.has(type)}
								onchange={() => toggleDocType(type)}
								class="rounded border-gray-300"
							/>
							<span class="text-sm">{type}</span>
						</label>
					{/each}
				</div>
			</AccordionContent>
		</AccordionItem>

		<AccordionItem value="classifications">
			<AccordionTrigger>Content Classification</AccordionTrigger>
			<AccordionContent>
				<div class="space-y-2 pl-2">
					{#each availableClassifications as classification}
						<label class="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedClassifications.has(classification)}
								onchange={() => toggleClassification(classification)}
								class="rounded border-gray-300"
							/>
							<span class="text-sm">{classification.replace(/_/g, ' ')}</span>
						</label>
					{/each}
				</div>
			</AccordionContent>
		</AccordionItem>

		<AccordionItem value="dateRange">
			<AccordionTrigger>Date Range</AccordionTrigger>
			<AccordionContent>
				<div class="space-y-3 pl-2">
					<div class="flex flex-wrap gap-1">
						{#each datePresets as preset}
							<button
								type="button"
								class="text-xs px-2 py-1 rounded border hover:bg-accent transition-colors"
								class:bg-accent={startDate === preset.start && endDate === preset.end}
								onclick={() => applyDatePreset(preset)}
							>
								{preset.label}
							</button>
						{/each}
					</div>
					<div>
						<label for="start-date" class="text-sm font-medium block mb-1">Start Date</label>
						<input
							id="start-date"
							type="date"
							bind:value={startDate}
							onchange={updateDateRange}
							class="w-full px-3 py-2 border rounded-md text-sm"
						/>
					</div>
					<div>
						<label for="end-date" class="text-sm font-medium block mb-1">End Date</label>
						<input
							id="end-date"
							type="date"
							bind:value={endDate}
							onchange={updateDateRange}
							class="w-full px-3 py-2 border rounded-md text-sm"
						/>
					</div>
				</div>
			</AccordionContent>
		</AccordionItem>

		<AccordionItem value="entities">
			<AccordionTrigger>Entity Mentions</AccordionTrigger>
			<AccordionContent>
				<EntityAutocomplete
					{selectedEntities}
					onAdd={onEntityAdd}
					onRemove={onEntityRemove}
				/>
			</AccordionContent>
		</AccordionItem>

		<AccordionItem value="savedSearches">
			<AccordionTrigger>Saved Searches</AccordionTrigger>
			<AccordionContent>
				<SavedSearches
					onLoad={onLoadSavedSearch}
					refreshKey={savedSearchRefreshKey}
				/>
			</AccordionContent>
		</AccordionItem>
	</Accordion>
</aside>
