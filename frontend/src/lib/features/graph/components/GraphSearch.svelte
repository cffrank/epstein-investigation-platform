<script lang="ts">
import { Search } from "@lucide/svelte";

const {
	onSearch,
	loading = false,
}: {
	onSearch: (query: string) => void;
	loading?: boolean;
} = $props();

const query = $state("");
const searchResults = $state<
	Array<{ id: string; label: string; type: string; connections: number }>
>([]);
let showResults = $state(false);

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" && query.trim()) {
		onSearch(query.trim());
		showResults = false;
	}
}

function handleFocus() {
	if (searchResults.length > 0) {
		showResults = true;
	}
}

function handleBlur() {
	// Delay to allow click on results
	setTimeout(() => {
		showResults = false;
	}, 200);
}
</script>

<div class="absolute left-4 top-4 z-10 w-96">
	<div class="relative">
		<div class="relative">
			<Search class="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
			<input
				type="text"
				placeholder="Search entities (Person, Organization, Location)..."
				bind:value={query}
				onkeydown={handleKeyDown}
				onfocus={handleFocus}
				onblur={handleBlur}
				disabled={loading}
				class="flex h-10 w-full rounded-md border bg-card px-3 py-2 pl-10 text-sm shadow-lg ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
			/>
		</div>

		{#if showResults && searchResults.length > 0}
			<div
				class="absolute mt-2 w-full rounded-lg border bg-card shadow-lg max-h-96 overflow-y-auto"
			>
				{#each searchResults as result}
					<button
						type="button"
						class="w-full px-4 py-2 text-left hover:bg-accent transition-colors flex items-center justify-between"
						onclick={() => {
							onSearch(result.label);
							showResults = false;
						}}
					>
						<div class="flex items-center gap-2">
							<div
								class="w-2 h-2 rounded-full"
								style="background-color: {result.type === 'Person'
									? '#3b82f6'
									: result.type === 'Organization'
										? '#22c55e'
										: '#f97316'}"
							></div>
							<span class="font-medium">{result.label}</span>
							<span class="text-xs text-muted-foreground">{result.type}</span>
						</div>
						<span class="text-xs text-muted-foreground">{result.connections} connections</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="mt-2 text-xs text-muted-foreground bg-card px-3 py-2 rounded-lg shadow-lg border">
			Searching...
		</div>
	{/if}
</div>
