<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { entityColor } from '$lib/utils';
	import { MessageSquare } from '@lucide/svelte';
	import type { EntityType } from '$lib/types';

	interface Props {
		name: string;
		type: EntityType;
		aliases: string[];
		documentCount: number;
		connectionCount: number;
	}

	let { name, type, aliases, documentCount, connectionCount }: Props = $props();

	let showAllAliases = $state(false);
	const MAX_VISIBLE_ALIASES = 3;

	const visibleAliases = $derived(
		showAllAliases ? aliases : aliases.slice(0, MAX_VISIBLE_ALIASES)
	);
	const hiddenCount = $derived(Math.max(0, aliases.length - MAX_VISIBLE_ALIASES));
</script>

<div class="space-y-4">
	<div class="flex items-start justify-between">
		<div class="space-y-2">
			<h1 class="text-4xl font-bold">{name}</h1>
			<div class="flex items-center gap-3">
				<Badge
					variant="secondary"
					class="text-base px-3 py-1"
					style="background-color: {entityColor(type)}; color: white;"
				>
					{type}
				</Badge>
			</div>

			{#if aliases.length > 0}
				<div class="text-sm text-muted-foreground">
					<span class="font-medium">AKA:</span>
					{visibleAliases.join(', ')}
					{#if hiddenCount > 0 && !showAllAliases}
						<button
							onclick={() => (showAllAliases = true)}
							class="ml-1 text-primary hover:underline font-medium"
						>
							+{hiddenCount} more
						</button>
					{:else if showAllAliases && hiddenCount > 0}
						<button
							onclick={() => (showAllAliases = false)}
							class="ml-1 text-primary hover:underline font-medium"
						>
							show less
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<a href="/chat?entity={encodeURIComponent(name)}">
			<Button variant="outline" class="gap-2">
				<MessageSquare class="size-4" />
				Ask Claude about {name}
			</Button>
		</a>
	</div>

	<div class="flex items-center gap-6 text-sm text-muted-foreground">
		<div>
			<span class="font-semibold">{documentCount}</span>
			{documentCount === 1 ? 'Document' : 'Documents'}
		</div>
		<div>
			<span class="font-semibold">{connectionCount}</span>
			{connectionCount === 1 ? 'Connection' : 'Connections'}
		</div>
	</div>
</div>
