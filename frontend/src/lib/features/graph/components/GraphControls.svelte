<script lang="ts">
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "@lucide/svelte";

const {
	stats,
	onFit,
	onZoomIn,
	onZoomOut,
	onReset,
}: {
	stats: { nodeCount: number; edgeCount: number };
	onFit: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onReset: () => void;
} = $props();
</script>

<div class="absolute right-4 top-4 z-10 flex flex-col gap-2 rounded-lg bg-card p-2 shadow-lg border">
	<div class="flex flex-col gap-1 border-b pb-2 mb-2">
		<div class="text-xs text-muted-foreground px-2">
			<span class="font-medium text-foreground">{stats.nodeCount}</span> nodes
		</div>
		<div class="text-xs text-muted-foreground px-2">
			<span class="font-medium text-foreground">{stats.edgeCount}</span> edges
		</div>
	</div>

	<button
		onclick={onFit}
		title="Fit to screen"
		class="flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-accent transition-colors"
	>
		<Maximize2 class="h-4 w-4" />
	</button>

	<button
		onclick={onZoomIn}
		title="Zoom in"
		class="flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-accent transition-colors"
	>
		<ZoomIn class="h-4 w-4" />
	</button>

	<button
		onclick={onZoomOut}
		title="Zoom out"
		class="flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-accent transition-colors"
	>
		<ZoomOut class="h-4 w-4" />
	</button>

	<button
		onclick={onReset}
		title="Clear graph"
		class="flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-accent transition-colors"
	>
		<RotateCcw class="h-4 w-4" />
	</button>
</div>
