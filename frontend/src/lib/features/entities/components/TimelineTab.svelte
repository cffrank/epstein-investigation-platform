<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import type { TimelineEvent } from '$lib/types';

	interface Props {
		events: TimelineEvent[];
	}

	let { events }: Props = $props();

	function formatDate(dateStr: string): string {
		try {
			return new Date(dateStr).toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});
		} catch {
			return dateStr;
		}
	}
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-xl font-semibold mb-4">Timeline</h2>
		<p class="text-sm text-muted-foreground mb-4">
			Chronological events related to this entity
		</p>
	</div>

	{#if events.length === 0}
		<Card.Root>
			<Card.Content class="py-8 text-center text-muted-foreground space-y-2">
				<p>No timeline events found for this entity.</p>
				<p class="text-xs">
					Timeline events will be enriched as the date extraction pipeline processes more
					documents.
				</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="relative space-y-6 pl-8 border-l-2 border-border">
			{#each events as event}
				<div class="relative">
					<!-- Dot on the timeline line -->
					<div
						class="absolute -left-[calc(2rem+5px)] top-1 h-2.5 w-2.5 rounded-full bg-primary"
					></div>

					<!-- Event content -->
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium">{formatDate(event.date)}</span>
							<Badge variant="outline">{event.event_type}</Badge>
						</div>
						<p class="text-sm text-foreground">{event.description}</p>
						{#if event.document_id}
							<a
								href="/documents/{event.document_id}"
								class="text-xs text-primary hover:underline"
							>
								{event.document_name || 'View document'}
							</a>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
