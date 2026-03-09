<script lang="ts">
import { Badge } from "$lib/components/ui/badge";
import { Input } from "$lib/components/ui/input";
import type { EntityRef } from "$lib/types";
import { entityColor } from "$lib/utils";
import { X } from "@lucide/svelte";

interface Props {
	selectedEntities: EntityRef[];
	onAdd: (entity: EntityRef) => void;
	onRemove: (entityId: string) => void;
}

const { selectedEntities, onAdd, onRemove }: Props = $props();

let inputValue = $state("");
let suggestions = $state<EntityRef[]>([]);
let showDropdown = $state(false);
let loading = $state(false);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// biome-ignore lint/style/useConst: Svelte $state variable is bound via bind:this
let containerEl: HTMLDivElement | undefined = $state();

function handleInput(event: Event) {
	const target = event.target as HTMLInputElement;
	inputValue = target.value;

	if (debounceTimer) clearTimeout(debounceTimer);

	if (!inputValue.trim()) {
		suggestions = [];
		showDropdown = false;
		return;
	}

	debounceTimer = setTimeout(() => {
		fetchSuggestions(inputValue.trim());
	}, 300);
}

async function fetchSuggestions(term: string) {
	loading = true;
	try {
		const response = await fetch(`/api/entities/autocomplete?q=${encodeURIComponent(term)}`);
		if (!response.ok) throw new Error("Failed to fetch");
		const data = (await response.json()) as EntityRef[];
		// Filter out already-selected entities
		const selectedIds = new Set(selectedEntities.map((e) => e.id));
		suggestions = data.filter((e) => !selectedIds.has(e.id));
		showDropdown = suggestions.length > 0;
	} catch {
		suggestions = [];
		showDropdown = false;
	} finally {
		loading = false;
	}
}

function selectEntity(entity: EntityRef) {
	onAdd(entity);
	inputValue = "";
	suggestions = [];
	showDropdown = false;
}

function handleClickOutside(event: MouseEvent) {
	if (containerEl && !containerEl.contains(event.target as Node)) {
		showDropdown = false;
	}
}

function badgeStyle(type: string): string {
	const color = entityColor(type);
	return `border-color: ${color}; color: ${color}`;
}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="space-y-2" bind:this={containerEl}>
	<div class="relative">
		<Input
			type="text"
			placeholder="Search entities..."
			value={inputValue}
			oninput={handleInput}
			onfocus={() => { if (suggestions.length > 0) showDropdown = true; }}
			class="text-sm"
		/>

		{#if showDropdown}
			<div class="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
				{#each suggestions as entity}
					<button
						type="button"
						class="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2 text-sm"
						onclick={() => selectEntity(entity)}
					>
						<span class="truncate">{entity.name}</span>
						<Badge variant="outline" class="text-xs shrink-0" style={badgeStyle(entity.type)}>
							{entity.type}
						</Badge>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if selectedEntities.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each selectedEntities as entity}
				<span
					class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border"
					style="border-color: {entityColor(entity.type)}"
				>
					<span
						class="w-2 h-2 rounded-full shrink-0"
						style="background-color: {entityColor(entity.type)}"
					></span>
					<span class="truncate max-w-[120px]">{entity.name}</span>
					<button
						type="button"
						class="hover:text-destructive shrink-0"
						onclick={() => onRemove(entity.id)}
					>
						<X class="h-3 w-3" />
					</button>
				</span>
			{/each}
		</div>
	{/if}
</div>
