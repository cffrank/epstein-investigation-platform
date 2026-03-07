<script lang="ts">
	import type { PageData } from './$types';
	import type { EntityRef } from '$lib/types';
	import { formatFileSize } from '$lib/utils';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import TextView from '$lib/features/document-viewer/components/TextView.svelte';
	import EntityList from '$lib/features/document-viewer/components/EntityList.svelte';

	let { data }: { data: PageData } = $props();

	const document = data.document!;
	const entities = data.entities as EntityRef[];

	const entityColors: Record<string, string> = {
		Person: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
		Organization: 'bg-green-500/20 text-green-400 border-green-500/30',
		Location: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
	};

	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="flex h-screen flex-col">
	<!-- Header -->
	<div class="border-b bg-background p-6">
		<h1 class="text-2xl font-bold">{document.filename}</h1>

		<!-- Metadata row -->
		<div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
			<Badge variant="outline" class="font-mono">{document.source}</Badge>
			{#if document.doc_type}
				<Badge variant="secondary">{document.doc_type}</Badge>
			{/if}
			{#if document.file_size_bytes}
				<span>{formatFileSize(document.file_size_bytes)}</span>
				<span>•</span>
			{/if}
			<span>{formatDate(document.created_at)}</span>
			{#if document.page_count}
				<span>•</span>
				<span>{document.page_count} pages</span>
			{/if}
		</div>

		<!-- Entity badges -->
		{#if entities.length > 0}
			<div class="mt-3 flex flex-wrap gap-2">
				{#each entities.slice(0, 10) as entity (entity.id)}
					<a
						href="/entities/{entity.id}"
						class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent {entityColors[
							entity.type
						]}"
					>
						{entity.name}
					</a>
				{/each}
				{#if entities.length > 10}
					<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
						+{entities.length - 10} more
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Split pane content -->
	<div class="flex-1 overflow-hidden">
		<Resizable.PaneGroup direction="horizontal">
			<Resizable.Pane defaultSize={60}>
				{#if document.text}
					<TextView text={document.text} {entities} />
				{:else}
					<div class="flex h-full items-center justify-center">
						<div class="rounded-md border border-dashed p-8 text-center">
							<p class="text-sm text-muted-foreground">No text extracted for this document</p>
							{#if document.r2_key}
								<p class="mt-2 text-xs text-muted-foreground">
									Document may be an image or scanned file requiring OCR
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</Resizable.Pane>

			<Resizable.Handle withHandle={true} />

			<Resizable.Pane defaultSize={40}>
				<div class="flex h-full flex-col overflow-hidden border-l">
					<!-- Entity panel -->
					<div class="flex-1 overflow-hidden">
						<EntityList {entities} />
					</div>

					<!-- Metadata section -->
					<div class="border-t p-4">
						<h3 class="mb-3 text-sm font-semibold">Document Metadata</h3>
						<dl class="space-y-2 text-xs">
							<div>
								<dt class="font-medium text-muted-foreground">Document ID</dt>
								<dd class="font-mono">{document.id}</dd>
							</div>
							{#if document.r2_key}
								<div>
									<dt class="font-medium text-muted-foreground">Storage Key</dt>
									<dd class="break-all font-mono text-xs">{document.r2_key}</dd>
								</div>
							{/if}
							{#if document.content_hash}
								<div>
									<dt class="font-medium text-muted-foreground">Content Hash</dt>
									<dd class="break-all font-mono text-xs">{document.content_hash}</dd>
								</div>
							{/if}
							<div>
								<dt class="font-medium text-muted-foreground">Created</dt>
								<dd>{formatDate(document.created_at)}</dd>
							</div>
						</dl>
					</div>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	</div>
</div>
