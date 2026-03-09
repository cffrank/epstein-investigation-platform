<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import * as Accordion from '$lib/components/ui/accordion';
	import { entityColor } from '$lib/utils';
	import type { EntityConnection, EntityCoOccurrence } from '$lib/types';

	interface Props {
		connections: EntityConnection[];
		coOccurrences: EntityCoOccurrence[];
	}

	let { connections, coOccurrences }: Props = $props();

	const connectionsByType = $derived.by(() => {
		const map = new Map<string, EntityConnection[]>();
		connections.forEach((conn) => {
			const key = conn.relationship_type;
			if (!map.has(key)) {
				map.set(key, []);
			}
			map.get(key)!.push(conn);
		});
		return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
	});
</script>

<div class="space-y-8">
	<!-- Direct Relationships -->
	<div>
		<div class="flex items-center gap-2 mb-4">
			<h2 class="text-xl font-semibold">Direct Relationships</h2>
			<Badge variant="outline">{connections.length}</Badge>
		</div>
		<p class="text-sm text-muted-foreground mb-4">
			Entities directly connected through relationships
		</p>

		{#if connections.length === 0}
			<Card.Root>
				<Card.Content class="py-8 text-center text-muted-foreground">
					No direct relationships found
				</Card.Content>
			</Card.Root>
		{:else}
			<Accordion.Root type="multiple">
				{#each connectionsByType as [relType, conns], i}
					<Accordion.Item value={`item-${i}`}>
						<Accordion.Trigger>
							<div class="flex items-center gap-2">
								<span class="font-semibold">{relType}</span>
								<Badge variant="outline">{conns.length}</Badge>
							</div>
						</Accordion.Trigger>
						<Accordion.Content>
							<div class="grid gap-2 md:grid-cols-2 lg:grid-cols-3 pt-2">
								{#each conns as conn}
									<a href="/entities/{conn.id}">
										<Card.Root class="hover:bg-muted/50 transition-colors cursor-pointer">
											<Card.Header class="p-4">
												<Card.Title class="text-sm">{conn.name}</Card.Title>
												<Card.Description>
													<Badge
														variant="secondary"
														style="background-color: {entityColor(conn.type)}; color: white;"
													>
														{conn.type}
													</Badge>
												</Card.Description>
											</Card.Header>
										</Card.Root>
									</a>
								{/each}
							</div>
						</Accordion.Content>
					</Accordion.Item>
				{/each}
			</Accordion.Root>
		{/if}
	</div>

	<!-- Co-occurring Entities -->
	<div>
		<div class="flex items-center gap-2 mb-4">
			<h2 class="text-xl font-semibold">Co-occurring Entities</h2>
			<Badge variant="outline">{coOccurrences.length}</Badge>
		</div>
		<p class="text-sm text-muted-foreground mb-4">
			Entities that frequently appear in the same documents
		</p>

		{#if coOccurrences.length === 0}
			<Card.Root>
				<Card.Content class="py-8 text-center text-muted-foreground">
					No co-occurring entities found
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
				{#each coOccurrences as coEntity}
					<a href="/entities/{coEntity.id}">
						<Card.Root class="hover:bg-muted/50 transition-colors cursor-pointer h-full">
							<Card.Header>
								<Card.Title class="text-base flex items-center justify-between">
									<span class="truncate">{coEntity.name}</span>
								</Card.Title>
								<Card.Description>
									<span class="flex items-center gap-2">
										<Badge
											variant="secondary"
											style="background-color: {entityColor(coEntity.type)}; color: white;"
										>
											{coEntity.type}
										</Badge>
										<span class="text-xs">
											{coEntity.shared_docs} {coEntity.shared_docs === 1 ? 'doc' : 'docs'}
										</span>
									</span>
								</Card.Description>
							</Card.Header>
						</Card.Root>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
