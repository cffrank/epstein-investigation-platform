<script lang="ts">
	import type { ToolCall } from '$lib/types';
	import { cn } from '$lib/utils';

	interface Props {
		toolCalls: ToolCall[];
	}

	let { toolCalls }: Props = $props();
	let expanded = $state(false);

	const toolLabels: Record<string, string> = {
		search_documents: 'Searching documents',
		semantic_search: 'Semantic search',
		get_entity_profile: 'Looking up entity',
		graph_query: 'Querying graph',
		find_connections: 'Finding connections',
	};

	function summaryText(tc: ToolCall): string {
		const label = toolLabels[tc.name] || tc.name;
		if (tc.status === 'running') return `${label}...`;
		if (tc.status === 'error') return `${label} — failed`;
		return `${label} — ${tc.resultCount ?? 0} results`;
	}

	const allComplete = $derived(toolCalls.every((tc) => tc.status !== 'running'));
</script>

{#if toolCalls.length > 0}
	<div class="mb-2">
		<button
			onclick={() => (expanded = !expanded)}
			class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
		>
			<span class="font-medium">
				{#if allComplete}
					{toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''} used
				{:else}
					Using tools...
				{/if}
			</span>
			<span class="text-xs">{expanded ? '▲' : '▼'}</span>
		</button>

		{#if !allComplete || expanded}
			<div class="mt-1.5 space-y-1">
				{#each toolCalls as tc}
					<div
						class={cn(
							'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
							tc.status === 'running'
								? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
								: tc.status === 'error'
									? 'bg-red-500/10 text-red-600 dark:text-red-400'
									: 'bg-muted text-muted-foreground'
						)}
					>
						{#if tc.status === 'running'}
							<span class="relative flex h-2 w-2 shrink-0">
								<span
									class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"
								></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-blue-500"
								></span>
							</span>
						{:else if tc.status === 'error'}
							<span class="text-red-500">✗</span>
						{:else}
							<span class="text-green-500">✓</span>
						{/if}
						<span>{summaryText(tc)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
