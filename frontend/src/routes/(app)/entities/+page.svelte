<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { entityColor } from '$lib/utils';
	import type { Entity, EntityType } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let searchQuery = $state('');
	let activeType = $state<EntityType | 'All'>('All');
	let entities = $state<Entity[]>(data.entities);
	let loading = $state(false);
	let page = $state(0);

	async function loadEntities(search?: string, type?: EntityType) {
		loading = true;
		try {
			const response = await fetch('/api/entities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: search ? 'search' : 'list',
					query: search,
					type: type && type !== 'All' ? type : undefined,
					offset: page * 50,
					limit: 50
				})
			});

			const result = await response.json();
			entities = result.entities || [];
		} catch (error) {
			console.error('Failed to load entities:', error);
			entities = [];
		} finally {
			loading = false;
		}
	}

	let searchTimeout: number | undefined;
	function handleSearch(event: Event) {
		const target = event.target as HTMLInputElement;
		searchQuery = target.value;

		// Debounce search
		clearTimeout(searchTimeout);
		searchTimeout = window.setTimeout(() => {
			page = 0;
			loadEntities(searchQuery || undefined, activeType !== 'All' ? activeType : undefined);
		}, 300);
	}

	function handleTypeChange(value: string) {
		activeType = value as EntityType | 'All';
		page = 0;
		loadEntities(searchQuery || undefined, activeType !== 'All' ? activeType : undefined);
	}

	function handlePrevPage() {
		if (page > 0) {
			page--;
			loadEntities(searchQuery || undefined, activeType !== 'All' ? activeType : undefined);
		}
	}

	function handleNextPage() {
		page++;
		loadEntities(searchQuery || undefined, activeType !== 'All' ? activeType : undefined);
	}

	const displayEntities = $derived(entities);
</script>

<div class="container mx-auto p-6 space-y-6">
	<div class="space-y-2">
		<h1 class="text-3xl font-bold">Entities</h1>
		<p class="text-muted-foreground">
			Browse people, organizations, and locations extracted from documents
		</p>
	</div>

	<div class="space-y-4">
		<!-- Search Bar -->
		<Input
			type="search"
			placeholder="Search entities..."
			value={searchQuery}
			oninput={handleSearch}
			class="max-w-md"
		/>

		<!-- Type Filter Tabs -->
		<Tabs.Root value={activeType} onValueChange={handleTypeChange}>
			<Tabs.List>
				<Tabs.Trigger value="All">All</Tabs.Trigger>
				<Tabs.Trigger value="Person">People</Tabs.Trigger>
				<Tabs.Trigger value="Organization">Organizations</Tabs.Trigger>
				<Tabs.Trigger value="Location">Locations</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<!-- Entity List -->
		{#if loading}
			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{#each Array(9) as _}
					<Card.Root>
						<Card.Header>
							<div class="h-6 bg-muted rounded animate-pulse"></div>
							<div class="h-4 bg-muted rounded w-2/3 animate-pulse"></div>
						</Card.Header>
					</Card.Root>
				{/each}
			</div>
		{:else if displayEntities.length === 0}
			<Card.Root>
				<Card.Content class="py-8 text-center text-muted-foreground">
					No entities found
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{#each displayEntities as entity (entity.id)}
					<a href="/entities/{entity.id}">
						<Card.Root class="hover:bg-muted/50 transition-colors cursor-pointer h-full">
							<Card.Header>
								<Card.Title class="flex items-center justify-between">
									<span class="truncate">{entity.name}</span>
								</Card.Title>
								<Card.Description>
									<div class="flex items-center gap-2">
										<Badge
											variant="secondary"
											style="background-color: {entityColor(entity.type)}; color: white;"
										>
											{entity.type}
										</Badge>
										{#if entity.connections !== undefined}
											<span class="text-xs text-muted-foreground">
												{entity.connections} {entity.connections === 1 ? 'connection' : 'connections'}
											</span>
										{/if}
									</div>
								</Card.Description>
							</Card.Header>
						</Card.Root>
					</a>
				{/each}
			</div>

			<!-- Pagination -->
			<div class="flex items-center justify-between">
				<Button variant="outline" disabled={page === 0} onclick={handlePrevPage}>
					Previous
				</Button>
				<span class="text-sm text-muted-foreground">Page {page + 1}</span>
				<Button
					variant="outline"
					disabled={displayEntities.length < 50}
					onclick={handleNextPage}
				>
					Next
				</Button>
			</div>
		{/if}
	</div>
</div>
