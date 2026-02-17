<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Separator } from '$lib/components/ui/separator';
	import * as Accordion from '$lib/components/ui/accordion';
	import { entityColor, truncate, formatFileSize } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const connectionsByType = $derived.by(() => {
		const map = new Map<string, typeof data.connections>();
		data.connections.forEach((conn) => {
			const key = conn.relationship_type;
			if (!map.has(key)) {
				map.set(key, []);
			}
			map.get(key)!.push(conn);
		});
		return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
	});

	function formatDate(dateStr: string): string {
		try {
			return new Date(dateStr).toLocaleDateString();
		} catch {
			return dateStr;
		}
	}
</script>

<div class="container mx-auto p-6 space-y-6">
	<!-- Header -->
	<div class="space-y-4">
		<div class="flex items-start justify-between">
			<div class="space-y-2">
				<h1 class="text-4xl font-bold">{data.name}</h1>
				<div class="flex items-center gap-3">
					<Badge
						variant="secondary"
						class="text-base px-3 py-1"
						style="background-color: {entityColor(data.type)}; color: white;"
					>
						{data.type}
					</Badge>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-6 text-sm text-muted-foreground">
			<div>
				<span class="font-semibold">{data.connections.length}</span>
				{data.connections.length === 1 ? 'Connection' : 'Connections'}
			</div>
			<div>
				<span class="font-semibold">{data.documents.length}</span>
				{data.documents.length === 1 ? 'Document' : 'Documents'}
			</div>
			<div>
				<span class="font-semibold">{data.co_occurrences.length}</span>
				Co-occurring {data.co_occurrences.length === 1 ? 'Entity' : 'Entities'}
			</div>
		</div>
	</div>

	<Separator />

	<!-- Tabs -->
	<Tabs.Root value="overview">
		<Tabs.List>
			<Tabs.Trigger value="overview">Overview</Tabs.Trigger>
			<Tabs.Trigger value="documents">Documents</Tabs.Trigger>
			<Tabs.Trigger value="connections">Connections</Tabs.Trigger>
		</Tabs.List>

		<!-- Overview Tab -->
		<Tabs.Content value="overview" class="space-y-6 mt-6">
			<div>
				<h2 class="text-xl font-semibold mb-4">Co-occurring Entities</h2>
				<p class="text-sm text-muted-foreground mb-4">
					Entities that frequently appear in the same documents
				</p>

				{#if data.co_occurrences.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-muted-foreground">
							No co-occurring entities found
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{#each data.co_occurrences as coEntity}
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
		</Tabs.Content>

		<!-- Documents Tab -->
		<Tabs.Content value="documents" class="space-y-4 mt-6">
			<div>
				<h2 class="text-xl font-semibold mb-4">Related Documents</h2>
				<p class="text-sm text-muted-foreground mb-4">
					Documents that mention this entity
				</p>

				{#if data.documents.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-muted-foreground">
							No documents found
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="space-y-3">
						{#each data.documents as doc}
							<a href="/documents/{doc.id}">
								<Card.Root class="hover:bg-muted/50 transition-colors cursor-pointer">
									<Card.Header>
										<Card.Title class="text-base">
											{truncate(doc.filename, 80)}
										</Card.Title>
										<Card.Description>
											<span class="flex items-center gap-2 flex-wrap">
												<Badge variant="outline">{doc.source}</Badge>
												{#if doc.doc_type}
													<Badge variant="secondary">{doc.doc_type}</Badge>
												{/if}
												<span class="text-xs text-muted-foreground">
													{formatDate(doc.created_at)}
												</span>
												{#if doc.file_size_bytes}
													<span class="text-xs text-muted-foreground">
														{formatFileSize(doc.file_size_bytes)}
													</span>
												{/if}
											</span>
										</Card.Description>
									</Card.Header>
								</Card.Root>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</Tabs.Content>

		<!-- Connections Tab -->
		<Tabs.Content value="connections" class="space-y-4 mt-6">
			<div>
				<h2 class="text-xl font-semibold mb-4">Direct Connections</h2>
				<p class="text-sm text-muted-foreground mb-4">
					Entities directly connected through relationships
				</p>

				{#if data.connections.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-muted-foreground">
							No direct connections found
						</Card.Content>
					</Card.Root>
				{:else}
					<Accordion.Root>
						{#each connectionsByType() as [relType, connections], i}
							<Accordion.Item value={`item-${i}`}>
								<Accordion.Trigger>
									<div class="flex items-center gap-2">
										<span class="font-semibold">{relType}</span>
										<Badge variant="outline">{connections.length}</Badge>
									</div>
								</Accordion.Trigger>
								<Accordion.Content>
									<div class="grid gap-2 md:grid-cols-2 lg:grid-cols-3 pt-2">
										{#each connections as conn}
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
		</Tabs.Content>
	</Tabs.Root>
</div>
