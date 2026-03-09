<script lang="ts">
	import type { ChatMessage } from '$lib/types';
	import { cn } from '$lib/utils';
	import { sanitizeChatContent } from '$lib/utils/sanitize';
	import ToolCallPanel from './ToolCallPanel.svelte';

	interface Props {
		message: ChatMessage;
	}

	let { message }: Props = $props();

	// Build citation reference map: source URL -> citation index
	const citationMap = $derived(() => {
		if (!message.citations?.length) return new Map<string, number>();
		const map = new Map<string, number>();
		const seen = new Set<string>();
		let idx = 1;
		for (const c of message.citations) {
			if (!seen.has(c.source)) {
				seen.add(c.source);
				map.set(c.source, idx++);
			}
		}
		return map;
	});

	// Render content with inline citation badges for cited text
	function renderContent(content: string): string {
		if (!message.citations?.length) return content;

		// Add superscript citation badges after cited text
		let result = content;
		const uniqueSources = new Map<string, { index: number; title: string; source: string }>();
		let idx = 1;

		for (const c of message.citations) {
			if (!uniqueSources.has(c.source)) {
				uniqueSources.set(c.source, { index: idx++, title: c.document_title, source: c.source });
			}
		}

		// Replace legacy [N] citation markers if any exist
		result = result.replace(
			/\[(\d+)\]/g,
			'<sup class="inline-flex items-center justify-center bg-primary text-primary-foreground rounded-full text-[10px] font-medium w-4 h-4 mx-0.5 cursor-pointer hover:opacity-80">$1</sup>'
		);

		return result;
	}

	const hasCitations = $derived((message.citations?.length ?? 0) > 0);
</script>

<div
	class={cn(
		'flex gap-3 px-6 py-4',
		message.role === 'user' ? 'justify-end' : 'justify-start'
	)}
>
	<div
		class={cn(
			'max-w-[80%] rounded-lg px-4 py-3',
			message.role === 'user'
				? 'bg-primary text-primary-foreground'
				: 'bg-muted text-foreground'
		)}
	>
		{#if message.role === 'assistant' && message.toolCalls?.length}
			<ToolCallPanel toolCalls={message.toolCalls} />
		{/if}

		<div class="whitespace-pre-wrap break-words text-sm">
			{#if message.role === 'user'}
				{message.content}
			{:else}
				{@html sanitizeChatContent(renderContent(message.content))}
			{/if}
		</div>

		{#if message.role === 'assistant' && hasCitations}
			<div class="mt-2 flex flex-wrap gap-1">
				{#each [...new Map(message.citations?.map((c) => [c.source, c]) || []).values()] as citation, i}
					<a
						href={citation.source}
						class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
						title="{citation.document_title}: {citation.cited_text.slice(0, 100)}..."
					>
						<sup class="font-bold">{i + 1}</sup>
						<span class="max-w-[120px] truncate">{citation.document_title}</span>
					</a>
				{/each}
			</div>
		{/if}

		{#if message.role === 'assistant' && message.content}
			<p class="mt-2 text-xs text-muted-foreground italic">
				{#if hasCitations}
					AI-generated · verify claims against source documents
				{:else}
					AI-generated · may contain errors · no sources cited
				{/if}
			</p>
		{/if}
	</div>
</div>
