<script lang="ts">
import { deleteSavedSearch, loadSavedSearches } from "$lib/features/search/saved-searches";
import type { SavedSearch } from "$lib/types";
import { X } from "@lucide/svelte";
import { onMount } from "svelte";

interface Props {
	onLoad: (saved: SavedSearch) => void;
	refreshKey?: number;
}

const { onLoad, refreshKey = 0 }: Props = $props();

let searches = $state<SavedSearch[]>([]);

onMount(() => {
	searches = loadSavedSearches();
});

// Re-load when refreshKey changes (triggered after saving a new search)
$effect(() => {
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	refreshKey;
	searches = loadSavedSearches();
});

function handleDelete(id: string, event: MouseEvent) {
	event.stopPropagation();
	searches = deleteSavedSearch(id);
}

function handleLoad(saved: SavedSearch) {
	onLoad(saved);
}

function formatRelativeDate(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}
</script>

<div class="space-y-1">
	{#if searches.length === 0}
		<p class="text-xs text-muted-foreground py-2">No saved searches yet</p>
	{:else}
		{#each searches as saved}
			<div class="group flex items-center justify-between gap-1 py-1.5 px-2 rounded hover:bg-accent cursor-pointer text-sm">
				<button
					type="button"
					class="flex-1 text-left truncate"
					onclick={() => handleLoad(saved)}
					title={saved.name}
				>
					{saved.name}
					<span class="text-xs text-muted-foreground ml-1">
						{formatRelativeDate(saved.createdAt)}
					</span>
				</button>
				<button
					type="button"
					class="opacity-0 group-hover:opacity-100 hover:text-destructive shrink-0"
					onclick={(e) => handleDelete(saved.id, e)}
				>
					<X class="h-3 w-3" />
				</button>
			</div>
		{/each}
	{/if}
</div>
