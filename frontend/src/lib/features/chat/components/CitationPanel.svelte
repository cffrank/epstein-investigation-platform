<script lang="ts">
import { Badge } from "$lib/components/ui/badge";
import { Card } from "$lib/components/ui/card";
import type { NativeCitation } from "$lib/types";
import { ChevronDown, ChevronUp } from "@lucide/svelte";

interface Props {
	citations: NativeCitation[];
}

const { citations }: Props = $props();
// biome-ignore lint/style/useConst: Svelte $state variable is reassigned reactively
let expanded = $state(true);

// Deduplicate citations by source, keeping first occurrence
const uniqueCitations = $derived(() => {
	const seen = new Set<string>();
	const result: Array<NativeCitation & { index: number }> = [];
	let idx = 1;
	for (const c of citations) {
		if (!seen.has(c.source)) {
			seen.add(c.source);
			result.push({ ...c, index: idx++ });
		}
	}
	return result;
});
</script>

{#if citations.length > 0}
	<div class="border-t border-border bg-muted/30 px-6 py-4">
		<button
			onclick={() => (expanded = !expanded)}
			class="flex w-full items-center justify-between text-sm font-medium"
		>
			<span>Sources ({uniqueCitations().length})</span>
			{#if expanded}
				<ChevronUp class="size-4" />
			{:else}
				<ChevronDown class="size-4" />
			{/if}
		</button>

		{#if expanded}
			<div class="mt-4 space-y-3">
				{#each uniqueCitations() as citation}
					<Card class="p-4">
						<a
							href={citation.source}
							class="block hover:bg-accent/50 transition-colors -m-4 p-4 rounded-lg"
						>
							<div class="flex items-start gap-3">
								<Badge variant="outline" class="mt-0.5 shrink-0">
									{citation.index}
								</Badge>
								<div class="min-w-0 flex-1 space-y-1">
									<div class="font-medium text-sm truncate">
										{citation.document_title}
									</div>
									<p class="text-xs text-muted-foreground line-clamp-2">
										{citation.cited_text}
									</p>
								</div>
							</div>
						</a>
					</Card>
				{/each}
			</div>
		{/if}
	</div>
{/if}
