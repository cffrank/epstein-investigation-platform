<script lang="ts">
	import * as HoverCard from '$lib/components/ui/hover-card';
	import { Badge } from '$lib/components/ui/badge';
	import { entityColor } from '$lib/utils';
	import type { EntityType } from '$lib/types';

	let { entityId, entityName, entityType }: {
		entityId: string;
		entityName: string;
		entityType: EntityType;
	} = $props();

	const color = $derived(entityColor(entityType));
</script>

<HoverCard.Root>
	<HoverCard.Trigger>
		<a href="/entities/{entityId}" class="inline-block">
			<Badge
				variant="secondary"
				class="cursor-pointer hover:opacity-80 transition-opacity"
				style="background-color: {color}; color: white;"
			>
				{entityName}
			</Badge>
		</a>
	</HoverCard.Trigger>
	<HoverCard.Content class="w-80">
		<div class="space-y-2">
			<h4 class="text-sm font-semibold">{entityName}</h4>
			<div class="flex items-center gap-2">
				<Badge variant="outline" style="border-color: {color}; color: {color};">
					{entityType}
				</Badge>
			</div>
			<p class="text-xs text-muted-foreground">
				Click to view full profile and related documents
			</p>
		</div>
	</HoverCard.Content>
</HoverCard.Root>
