<script lang="ts">
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { entityColor } from "$lib/utils";

interface HiddenConnectionPair {
	personAId: string;
	personAName: string;
	personBId: string;
	personBName: string;
	sharedCount: number;
	topSharedNeighbors: Array<{ id: string; name: string; type: string }>;
}

interface Props {
	pairs: HiddenConnectionPair[];
	onLoadPair: (pair: HiddenConnectionPair) => void;
}

const { pairs, onLoadPair }: Props = $props();

let expandedPair = $state<number | null>(null);

function togglePair(index: number) {
	expandedPair = expandedPair === index ? null : index;
}
</script>

<div class="space-y-1">
	{#if pairs.length === 0}
		<p class="px-2 py-2 text-xs text-muted-foreground">
			No hidden connections found. Run computation first.
		</p>
	{:else}
		{#each pairs as pair, i}
			<div class="rounded-md border">
				<button
					class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent/50 transition-colors"
					onclick={() => togglePair(i)}
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1">
							<span class="truncate font-medium">{pair.personAName}</span>
							<span class="text-muted-foreground">&mdash;</span>
							<span class="truncate font-medium">{pair.personBName}</span>
						</div>
					</div>
					<Badge variant="secondary" class="shrink-0 text-xs">
						{pair.sharedCount} shared
					</Badge>
				</button>

				{#if expandedPair === i}
					<div class="border-t px-2 py-2 space-y-2">
						<div class="space-y-1">
							<p class="text-xs font-medium text-muted-foreground">Shared neighbors:</p>
							{#each pair.topSharedNeighbors as neighbor}
								<div class="flex items-center gap-1.5 text-xs">
									<span class="truncate">{neighbor.name}</span>
									<Badge
										variant="secondary"
										class="text-[10px] px-1 py-0"
										style="background-color: {entityColor(neighbor.type)}; color: white;"
									>
										{neighbor.type}
									</Badge>
								</div>
							{/each}
						</div>
						<Button
							variant="outline"
							size="sm"
							class="w-full text-xs"
							onclick={() => onLoadPair(pair)}
						>
							Load to graph
						</Button>
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>
