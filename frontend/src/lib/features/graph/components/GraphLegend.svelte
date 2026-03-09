<script lang="ts">
	const COMMUNITY_PALETTE = [
		'#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
		'#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'
	];

	const TYPE_ITEMS = [
		{ label: 'Person', color: '#3b82f6', shape: 'circle' },
		{ label: 'Organization', color: '#22c55e', shape: 'diamond' },
		{ label: 'Location', color: '#f97316', shape: 'triangle' }
	] as const;

	let {
		colorMode = 'type',
		communitySizes = []
	}: {
		colorMode: 'type' | 'community';
		communitySizes: Array<{ communityId: number; size: number }>;
	} = $props();
</script>

<div class="absolute bottom-4 right-4 z-10 rounded-lg bg-card/90 backdrop-blur-sm p-3 shadow-lg border text-xs min-w-[140px]">
	<p class="font-semibold text-muted-foreground mb-2 uppercase tracking-wide" style="font-size: 10px;">
		{colorMode === 'type' ? 'Entity Types' : 'Communities'}
	</p>

	{#if colorMode === 'type'}
		{#each TYPE_ITEMS as item}
			<div class="flex items-center gap-2 py-0.5">
				<span
					class="w-3 h-3 rounded-full inline-block shrink-0"
					style="background-color: {item.color};"
				></span>
				<span class="text-foreground">{item.label}</span>
			</div>
		{/each}
	{:else}
		{#each communitySizes.slice(0, 8) as entry, i}
			<div class="flex items-center gap-2 py-0.5">
				<span
					class="w-3 h-3 rounded-full inline-block shrink-0"
					style="background-color: {COMMUNITY_PALETTE[i]};"
				></span>
				<span class="text-foreground">Community {i + 1}</span>
				<span class="text-muted-foreground ml-auto">({entry.size})</span>
			</div>
		{/each}
		{#if communitySizes.length > 8}
			<div class="flex items-center gap-2 py-0.5">
				<span
					class="w-3 h-3 rounded-full inline-block shrink-0"
					style="background-color: #71717a;"
				></span>
				<span class="text-foreground">Other</span>
			</div>
		{/if}
	{/if}

	<!-- Shape legend -->
	<div class="mt-2 pt-2 border-t border-border">
		<p class="font-semibold text-muted-foreground mb-1 uppercase tracking-wide" style="font-size: 10px;">Shapes</p>
		<div class="flex items-center gap-2 py-0.5">
			<svg class="w-3 h-3 shrink-0" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#71717a"/></svg>
			<span class="text-foreground">Person</span>
		</div>
		<div class="flex items-center gap-2 py-0.5">
			<svg class="w-3 h-3 shrink-0" viewBox="0 0 12 12"><polygon points="6,0 12,6 6,12 0,6" fill="#71717a"/></svg>
			<span class="text-foreground">Organization</span>
		</div>
		<div class="flex items-center gap-2 py-0.5">
			<svg class="w-3 h-3 shrink-0" viewBox="0 0 12 12"><polygon points="6,0 12,12 0,12" fill="#71717a"/></svg>
			<span class="text-foreground">Location</span>
		</div>
	</div>
</div>
