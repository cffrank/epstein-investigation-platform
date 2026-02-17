<script lang="ts">
	import type { ChatMessage } from '$lib/types';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';

	interface Props {
		message: ChatMessage;
	}

	let { message }: Props = $props();

	function renderContent(content: string): string {
		// Replace citation markers [1], [2], etc. with HTML badges
		return content.replace(
			/\[(\d+)\]/g,
			'<span class="inline-flex items-center justify-center bg-primary text-primary-foreground rounded-full text-xs font-medium px-1.5 py-0.5 mx-0.5">$1</span>'
		);
	}
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
		<div class="whitespace-pre-wrap break-words text-sm">
			{#if message.role === 'user'}
				{message.content}
			{:else}
				{@html renderContent(message.content)}
			{/if}
		</div>
	</div>
</div>
