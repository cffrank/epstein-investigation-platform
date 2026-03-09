<script lang="ts">
import Badge from "$lib/components/ui/badge/badge.svelte";
import type { EntityRef } from "$lib/types";
import { cn } from "$lib/utils";

const { entities }: { entities: EntityRef[] } = $props();

const entityColors = {
	Person: "bg-blue-500/20 text-blue-400 border-blue-500/30",
	Organization: "bg-green-500/20 text-green-400 border-green-500/30",
	Location: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const groupedEntities = $derived.by(() => {
	const groups: Record<string, EntityRef[]> = {
		Person: [],
		Organization: [],
		Location: [],
	};

	for (const entity of entities) {
		if (groups[entity.type]) {
			groups[entity.type].push(entity);
		}
	}

	return groups;
});

const entityCounts = $derived({
	Person: groupedEntities.Person.length,
	Organization: groupedEntities.Organization.length,
	Location: groupedEntities.Location.length,
});
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="border-b p-4">
		<h3 class="text-sm font-semibold">Entities</h3>
		<p class="text-xs text-muted-foreground">
			{entities.length} total entities mentioned
		</p>
	</div>

	<div class="flex-1 overflow-y-auto p-4">
		<!-- People -->
		{#if entityCounts.Person > 0}
			<div class="mb-6">
				<div class="mb-2 flex items-center justify-between">
					<h4 class="text-sm font-medium">People</h4>
					<span class="text-xs text-muted-foreground">{entityCounts.Person}</span>
				</div>
				<div class="space-y-1">
					{#each groupedEntities.Person as entity (entity.id)}
						<a
							href="/entities/{entity.id}"
							class={cn(
								'block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent',
								entityColors.Person
							)}
						>
							{entity.name}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Organizations -->
		{#if entityCounts.Organization > 0}
			<div class="mb-6">
				<div class="mb-2 flex items-center justify-between">
					<h4 class="text-sm font-medium">Organizations</h4>
					<span class="text-xs text-muted-foreground">{entityCounts.Organization}</span>
				</div>
				<div class="space-y-1">
					{#each groupedEntities.Organization as entity (entity.id)}
						<a
							href="/entities/{entity.id}"
							class={cn(
								'block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent',
								entityColors.Organization
							)}
						>
							{entity.name}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Locations -->
		{#if entityCounts.Location > 0}
			<div class="mb-6">
				<div class="mb-2 flex items-center justify-between">
					<h4 class="text-sm font-medium">Locations</h4>
					<span class="text-xs text-muted-foreground">{entityCounts.Location}</span>
				</div>
				<div class="space-y-1">
					{#each groupedEntities.Location as entity (entity.id)}
						<a
							href="/entities/{entity.id}"
							class={cn(
								'block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent',
								entityColors.Location
							)}
						>
							{entity.name}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		{#if entities.length === 0}
			<div class="rounded-md border border-dashed p-8 text-center">
				<p class="text-sm text-muted-foreground">No entities found in this document</p>
			</div>
		{/if}
	</div>
</div>
