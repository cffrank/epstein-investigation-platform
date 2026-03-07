<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '$lib/components/ui/accordion';
	import { X } from '@lucide/svelte';

	interface Props {
		sources?: string[];
		docTypes?: string[];
		classifications?: string[];
		dateRange?: [string, string];
		onFilterChange: (filters: {
			sources?: string[];
			docTypes?: string[];
			classifications?: string[];
			dateRange?: [string, string];
		}) => void;
	}

	let { sources = [], docTypes = [], classifications = [], dateRange, onFilterChange }: Props = $props();

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

	function emitFilters() {
		onFilterChange({
			sources: selectedSources.size > 0 ? Array.from(selectedSources) : undefined,
			docTypes: selectedDocTypes.size > 0 ? Array.from(selectedDocTypes) : undefined,
			classifications: selectedClassifications.size > 0 ? Array.from(selectedClassifications) : undefined,
			dateRange:
				startDate && endDate ? ([startDate, endDate] as [string, string]) : undefined
		});
	}

	function clearAll() {
		selectedSources.clear();
		selectedDocTypes.clear();
		selectedClassifications.clear();
		startDate = '';
		endDate = '';
		emitFilters();
	}

	let hasActiveFilters = $derived(
		selectedSources.size > 0 || selectedDocTypes.size > 0 || selectedClassifications.size > 0 || (startDate && endDate)
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

	<Accordion class="w-full" value="sources">
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
	</Accordion>
</aside>
