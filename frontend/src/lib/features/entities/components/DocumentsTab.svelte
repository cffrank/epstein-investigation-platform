<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { truncate, formatFileSize } from '$lib/utils';

	interface DocItem {
		id: string;
		filename: string;
		source: string;
		doc_type: string | null;
		file_size_bytes: number | null;
		created_at: string;
	}

	interface Props {
		documents: DocItem[];
	}

	let { documents }: Props = $props();

	let searchQuery = $state('');
	let selectedDocType = $state('all');

	const docTypes = $derived(() => {
		const types = new Set(documents.filter((d) => d.doc_type).map((d) => d.doc_type!));
		return ['all', ...Array.from(types).sort()];
	});

	const filteredDocs = $derived(() => {
		let result = documents;
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter((d) => d.filename.toLowerCase().includes(q));
		}
		if (selectedDocType !== 'all') {
			result = result.filter((d) => d.doc_type === selectedDocType);
		}
		return result;
	});

	function formatDate(dateStr: string): string {
		try {
			return new Date(dateStr).toLocaleDateString();
		} catch {
			return dateStr;
		}
	}

	function clearFilters() {
		searchQuery = '';
		selectedDocType = 'all';
	}
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-xl font-semibold mb-4">Related Documents</h2>
		<p class="text-sm text-muted-foreground mb-4">
			Documents that mention this entity
		</p>
	</div>

	<!-- Filter bar -->
	<div class="flex items-center gap-3">
		<Input
			placeholder="Search documents..."
			bind:value={searchQuery}
			class="max-w-sm"
		/>
		<select
			bind:value={selectedDocType}
			class="rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
		>
			{#each docTypes() as dtype}
				<option value={dtype}>
					{dtype === 'all' ? 'All types' : dtype}
				</option>
			{/each}
		</select>
		<span class="text-sm text-muted-foreground whitespace-nowrap">
			{filteredDocs().length} of {documents.length} documents
		</span>
	</div>

	<!-- Document list -->
	{#if documents.length === 0}
		<Card.Root>
			<Card.Content class="py-8 text-center text-muted-foreground">
				No documents found for this entity
			</Card.Content>
		</Card.Root>
	{:else if filteredDocs().length === 0}
		<Card.Root>
			<Card.Content class="py-8 text-center text-muted-foreground">
				<p>No documents match your filters</p>
				<Button variant="link" onclick={clearFilters} class="mt-2">Clear filters</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="space-y-3">
			{#each filteredDocs() as doc}
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
