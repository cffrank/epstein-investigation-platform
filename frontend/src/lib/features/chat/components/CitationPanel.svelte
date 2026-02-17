<script lang="ts">
	import type { Citation } from '$lib/types';
	import { Badge } from '$lib/components/ui/badge';
	import { Card } from '$lib/components/ui/card';
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	interface Props {
		citations: Citation[];
	}

	let { citations }: Props = $props();
	let expanded = $state(true);
</script>

{#if citations.length > 0}
	<div class="border-t border-border bg-muted/30 px-6 py-4">
		<button
			onclick={() => (expanded = !expanded)}
			class="flex w-full items-center justify-between text-sm font-medium"
		>
			<span>Sources ({citations.length})</span>
			{#if expanded}
				<ChevronUp class="size-4" />
			{:else}
				<ChevronDown class="size-4" />
			{/if}
		</button>

		{#if expanded}
			<div class="mt-4 space-y-3">
				{#each citations as citation}
					<Card class="p-4">
						<a
							href="/documents/{citation.document_id}"
							class="block hover:bg-accent/50 transition-colors -m-4 p-4 rounded-lg"
						>
							<div class="flex items-start gap-3">
								<Badge variant="outline" class="mt-0.5 shrink-0">
									{citation.index}
								</Badge>
								<div class="min-w-0 flex-1 space-y-1">
									<div class="font-medium text-sm truncate">
										{citation.filename}
									</div>
									<Badge variant="secondary" class="text-xs">
										{citation.source}
									</Badge>
									<p class="text-xs text-muted-foreground line-clamp-2">
										{citation.excerpt}
									</p>
									<div class="text-xs text-muted-foreground">
										Score: {citation.score.toFixed(3)}
									</div>
								</div>
							</div>
						</a>
					</Card>
				{/each}
			</div>
		{/if}
	</div>
{/if}
