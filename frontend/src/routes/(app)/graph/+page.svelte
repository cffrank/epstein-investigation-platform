<script lang="ts">
	import { onMount } from 'svelte';
	import GraphCanvas from '$lib/features/graph/components/GraphCanvas.svelte';
	import GraphControls from '$lib/features/graph/components/GraphControls.svelte';
	import GraphSearch from '$lib/features/graph/components/GraphSearch.svelte';
	import AnalysisSidebar from '$lib/features/graph/components/AnalysisSidebar.svelte';
	import GraphLegend from '$lib/features/graph/components/GraphLegend.svelte';
	import * as graphStore from '$lib/features/graph/stores.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { entityColor } from '$lib/utils';
	import { ExternalLink, X } from '@lucide/svelte';

	let canvasRef: GraphCanvas | null = null;

	let elements = $derived(graphStore.getElements());
	let selectedNode = $derived(graphStore.getSelectedNode());
	let loading = $derived(graphStore.getLoading());
	let error = $derived(graphStore.getError());
	let stats = $derived(graphStore.getStats());
	let colorMode = $derived(graphStore.getColorMode());
	let communitySizes = $derived(graphStore.getCommunitySizes());

	// Get selected node details from elements
	let selectedNodeData = $derived.by(() => {
		if (!selectedNode) return null;
		const el = elements.find((e) => e.data.id === selectedNode && !('source' in e.data));
		return el ? el.data : null;
	});

	function handleSearch(query: string) {
		graphStore.searchEntities(query);
	}

	function handleNodeTap(nodeId: string) {
		graphStore.selectNode(nodeId);
		graphStore.expandNode(nodeId);
	}

	function handleFit() {
		canvasRef?.fit();
	}

	function handleZoomIn() {
		canvasRef?.zoomIn();
	}

	function handleZoomOut() {
		canvasRef?.zoomOut();
	}

	function handleReset() {
		graphStore.resetGraph();
		canvasRef?.reset();
	}

	onMount(() => {
		return () => {
			graphStore.resetGraph();
		};
	});
</script>

<div class="flex h-[calc(100vh-0px)] w-full overflow-hidden">
	<AnalysisSidebar />

	<div class="relative flex-1 overflow-hidden">
	<GraphCanvas
		bind:this={canvasRef}
		bind:elements
		{selectedNode}
		{colorMode}
		{communitySizes}
		onNodeTap={handleNodeTap}
	/>

	<GraphLegend {colorMode} {communitySizes} />

	<GraphSearch onSearch={handleSearch} {loading} />

	<GraphControls
		{stats}
		onFit={handleFit}
		onZoomIn={handleZoomIn}
		onZoomOut={handleZoomOut}
		onReset={handleReset}
	/>

	<!-- Selected Node Detail Panel -->
	{#if selectedNodeData}
		<div class="absolute bottom-4 left-4 z-10 w-72 rounded-lg bg-card p-4 shadow-lg border">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<h3 class="font-semibold truncate">{selectedNodeData.label}</h3>
					<Badge
						variant="secondary"
						class="mt-1"
						style="background-color: {entityColor(('type' in selectedNodeData ? selectedNodeData.type : ''))}; color: white;"
					>
						{('type' in selectedNodeData ? selectedNodeData.type : '')}
					</Badge>
				</div>
				<button
					onclick={() => graphStore.selectNode(null)}
					class="shrink-0 rounded-md p-1 hover:bg-accent transition-colors"
				>
					<X class="size-4" />
				</button>
			</div>
			<div class="mt-3">
				<a href="/entities/{selectedNodeData.id}">
					<Button variant="outline" size="sm" class="w-full">
						<ExternalLink class="mr-2 size-3" />
						View Entity Profile
					</Button>
				</a>
			</div>
		</div>
	{/if}

	{#if error}
		<div
			class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-md bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg border"
		>
			<p class="text-sm font-medium">Error: {error}</p>
		</div>
	{/if}

	{#if elements.length === 0 && !loading && !error}
		<div
			class="absolute inset-0 flex items-center justify-center pointer-events-none"
		>
			<div class="text-center space-y-2">
				<p class="text-xl font-semibold text-muted-foreground">
					Search for an entity to begin
				</p>
				<p class="text-sm text-muted-foreground">
					Try searching for people, organizations, or locations
				</p>
			</div>
		</div>
	{/if}
	</div>
</div>
