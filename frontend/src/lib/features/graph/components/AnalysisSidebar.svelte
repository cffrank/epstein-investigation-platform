<script lang="ts">
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "$lib/components/ui/accordion";
import { Button } from "$lib/components/ui/button";
import * as graphStore from "$lib/features/graph/stores.svelte";
import { Loader2, RefreshCw } from "@lucide/svelte";
import { onMount } from "svelte";
import AlgorithmSection from "./AlgorithmSection.svelte";
import HiddenConnections from "./HiddenConnections.svelte";

const status = $derived(graphStore.getAlgorithmStatus());
const computing = $derived(graphStore.getComputing());
const colorMode = $derived(graphStore.getColorMode());
const activeAlgorithm = $derived(graphStore.getActiveAlgorithm());
const pagerankResults = $derived(graphStore.getPagerankResults());
const communityResults = $derived(graphStore.getCommunityResults());
const bridgeResults = $derived(graphStore.getBridgeResults());
const hiddenConnections = $derived(graphStore.getHiddenConnections());

// biome-ignore lint/style/useConst: Svelte $state variable is bound via bind:value
let accordionValue = $state<string>("");

function relativeTime(dateStr: string | null): string {
	if (!dateStr) return "Not yet computed";
	const diff = Date.now() - new Date(dateStr).getTime();
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function handleEntityClick(id: string) {
	graphStore.selectNode(id);
	graphStore.expandNode(id);
}

$effect(() => {
	if (accordionValue === "pagerank" && pagerankResults.length === 0) {
		graphStore.loadPageRank();
	} else if (accordionValue === "communities" && communityResults.length === 0) {
		graphStore.loadCommunities();
	} else if (accordionValue === "bridges" && bridgeResults.length === 0) {
		graphStore.loadBridges();
	} else if (accordionValue === "hidden-connections" && hiddenConnections.length === 0) {
		graphStore.loadHiddenConnections();
	}
});

onMount(() => {
	graphStore.loadAlgorithmStatus();
});
</script>

<aside class="flex h-full w-72 shrink-0 flex-col border-r bg-background overflow-y-auto">
	<div class="p-4 space-y-4">
		<!-- Header -->
		<div>
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Analysis</h2>
				<Button
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0"
					onclick={() => graphStore.triggerComputation()}
					disabled={computing}
				>
					{#if computing}
						<Loader2 class="size-3.5 animate-spin" />
					{:else}
						<RefreshCw class="size-3.5" />
					{/if}
				</Button>
			</div>
			<p class="text-xs text-muted-foreground mt-0.5">
				{relativeTime(status.lastComputed)}
				{#if status.nodeCount > 0}
					&middot; {status.nodeCount.toLocaleString()} nodes
				{/if}
			</p>
		</div>

		<!-- Color Mode Toggle -->
		<div class="flex rounded-md border p-0.5">
			<button
				class="flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors {colorMode === 'type'
					? 'bg-primary text-primary-foreground'
					: 'hover:bg-accent'}"
				onclick={() => graphStore.setColorMode('type')}
			>
				Type
			</button>
			<button
				class="flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors {colorMode === 'community'
					? 'bg-primary text-primary-foreground'
					: 'hover:bg-accent'}"
				onclick={() => graphStore.setColorMode('community')}
			>
				Community
			</button>
		</div>

		<!-- Algorithm Sections -->
		<Accordion type="single" bind:value={accordionValue}>
			<AccordionItem value="pagerank">
				<AccordionTrigger class="text-sm py-2">PageRank</AccordionTrigger>
				<AccordionContent>
					<AlgorithmSection
						title="PageRank"
						results={pagerankResults}
						scoreKey="pagerank"
						active={activeAlgorithm === 'pagerank'}
						onActivate={() => graphStore.loadPageRank()}
						onEntityClick={handleEntityClick}
					/>
				</AccordionContent>
			</AccordionItem>

			<AccordionItem value="communities">
				<AccordionTrigger class="text-sm py-2">Communities</AccordionTrigger>
				<AccordionContent>
					<AlgorithmSection
						title="Communities"
						results={communityResults}
						scoreKey="pagerank"
						active={activeAlgorithm === 'communities'}
						onActivate={() => graphStore.loadCommunities()}
						onEntityClick={handleEntityClick}
					/>
				</AccordionContent>
			</AccordionItem>

			<AccordionItem value="bridges">
				<AccordionTrigger class="text-sm py-2">Bridge Nodes</AccordionTrigger>
				<AccordionContent>
					<AlgorithmSection
						title="Bridge Nodes"
						results={bridgeResults}
						scoreKey="betweenness"
						active={activeAlgorithm === 'bridges'}
						onActivate={() => graphStore.loadBridges()}
						onEntityClick={handleEntityClick}
					/>
				</AccordionContent>
			</AccordionItem>

			<AccordionItem value="hidden-connections">
				<AccordionTrigger class="text-sm py-2">Hidden Connections</AccordionTrigger>
				<AccordionContent>
					<HiddenConnections
						pairs={hiddenConnections}
						onLoadPair={(pair) => graphStore.loadHiddenConnectionPair(pair)}
					/>
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	</div>
</aside>
