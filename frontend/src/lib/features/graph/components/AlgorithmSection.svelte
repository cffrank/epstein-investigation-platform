<script lang="ts">
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { entityColor } from "$lib/utils";

interface AlgorithmResult {
	id: string;
	type: string;
	name: string;
	pagerank: number | null;
	communityId: number | null;
	betweenness: number | null;
	connections: number;
}

interface Props {
	title: string;
	results: AlgorithmResult[];
	scoreKey: "pagerank" | "betweenness";
	active: boolean;
	onActivate: () => void;
	onEntityClick: (id: string) => void;
	maxResults?: number;
}

const {
	title,
	results,
	scoreKey,
	active,
	onActivate,
	onEntityClick,
	maxResults = 10,
}: Props = $props();

// biome-ignore lint/style/useConst: Svelte $state variable is reassigned reactively
let showAll = $state(false);

const displayResults = $derived(showAll ? results.slice(0, 25) : results.slice(0, maxResults));

const maxScore = $derived(() => {
	const scores = results
		.map((r) => (scoreKey === "pagerank" ? r.pagerank : r.betweenness))
		.filter((s): s is number => s != null);
	return scores.length > 0 ? Math.max(...scores) : 1;
});

function getScore(result: AlgorithmResult): number {
	const val = scoreKey === "pagerank" ? result.pagerank : result.betweenness;
	return val ?? 0;
}

function getScoreWidth(result: AlgorithmResult): number {
	const score = getScore(result);
	const max = maxScore();
	return max > 0 ? (score / max) * 100 : 0;
}
</script>

<div>
	<button
		class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent transition-colors {active
			? 'bg-accent'
			: ''}"
		onclick={() => {
			if (!active) onActivate();
		}}
	>
		{title}
		<span class="text-xs text-muted-foreground">{results.length}</span>
	</button>

	{#if active && displayResults.length > 0}
		<div class="mt-1 space-y-1">
			{#each displayResults as result, i}
				<button
					class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50 transition-colors"
					onclick={() => onEntityClick(result.id)}
				>
					<span class="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground w-5 text-right"
						>{i + 1}</span
					>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<span class="truncate font-medium">{result.name}</span>
							<Badge
								variant="secondary"
								class="shrink-0 text-[10px] px-1 py-0"
								style="background-color: {entityColor(result.type)}; color: white;"
							>
								{result.type}
							</Badge>
						</div>
						<div class="mt-0.5 h-1.5 w-full rounded-full bg-primary/20">
							<div
								class="h-full rounded-full bg-primary transition-all"
								style="width: {getScoreWidth(result)}%"
							></div>
						</div>
					</div>
				</button>
			{/each}

			{#if results.length > maxResults}
				<Button
					variant="ghost"
					size="sm"
					class="w-full text-xs"
					onclick={() => (showAll = !showAll)}
				>
					{showAll ? 'Show less' : `Show more (${results.length})`}
				</Button>
			{/if}
		</div>
	{/if}

	{#if active && results.length === 0}
		<p class="px-2 py-2 text-xs text-muted-foreground">
			No results. Run computation first.
		</p>
	{/if}
</div>
