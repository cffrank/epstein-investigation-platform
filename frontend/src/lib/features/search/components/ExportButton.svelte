<script lang="ts">
import { Button } from "$lib/components/ui/button";
import type { SearchFilters, SearchMode } from "$lib/types";
import { Download } from "@lucide/svelte";

interface Props {
	query: string;
	mode: SearchMode;
	filters: SearchFilters;
	disabled?: boolean;
}

const { query, mode, filters, disabled = false }: Props = $props();

let showMenu = $state(false);
let exporting = $state(false);
// biome-ignore lint/style/useConst: Svelte $state variable is bound via bind:this
let containerEl: HTMLDivElement | undefined = $state();

function handleClickOutside(event: MouseEvent) {
	if (containerEl && !containerEl.contains(event.target as Node)) {
		showMenu = false;
	}
}

async function handleExport(format: "csv" | "json") {
	showMenu = false;
	exporting = true;

	try {
		const response = await fetch("/api/search/export", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, filters, mode, format }),
		});

		if (!response.ok) throw new Error("Export failed");

		const blob = await response.blob();
		const ext = format === "csv" ? "csv" : "json";
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `search-results.${ext}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	} catch (err) {
		console.error("Export error:", err);
	} finally {
		exporting = false;
	}
}

const isDisabled = $derived(disabled || !query.trim() || exporting);
</script>

<svelte:window onclick={handleClickOutside} />

<div class="relative" bind:this={containerEl}>
	<Button
		variant="outline"
		size="sm"
		disabled={isDisabled}
		onclick={() => { showMenu = !showMenu; }}
	>
		<Download class="h-4 w-4 mr-1" />
		{exporting ? 'Exporting...' : 'Export'}
	</Button>

	{#if showMenu}
		<div class="absolute z-50 top-full right-0 mt-1 bg-popover border border-border rounded-md shadow-lg min-w-[160px]">
			<button
				type="button"
				class="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-t-md"
				onclick={() => handleExport('csv')}
			>
				Export as CSV
			</button>
			<button
				type="button"
				class="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-b-md"
				onclick={() => handleExport('json')}
			>
				Export as JSON
			</button>
		</div>
	{/if}
</div>
