<script lang="ts">
	import { chatStore } from '$lib/features/chat/stores.svelte';
	import ChatMessage from '$lib/features/chat/components/ChatMessage.svelte';
	import ChatInput from '$lib/features/chat/components/ChatInput.svelte';
	import CitationPanel from '$lib/features/chat/components/CitationPanel.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Plus, Loader2 } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let messagesContainer: HTMLDivElement;

	function scrollToBottom() {
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	$effect(() => {
		// Scroll to bottom when messages change
		chatStore.messages;
		setTimeout(scrollToBottom, 100);
	});

	async function handleSend(content: string) {
		await chatStore.sendMessage(content);
	}

	function handleClear() {
		chatStore.clearChat();
	}
</script>

<div class="flex h-[calc(100vh-4rem)] flex-col">
	<!-- Header -->
	<div class="border-b border-border px-6 py-4">
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold">AI Chat</h1>
				<p class="text-sm text-muted-foreground">
					Ask questions about the document corpus with source citations
				</p>
			</div>
			<Button variant="outline" onclick={handleClear} disabled={chatStore.isStreaming}>
				<Plus class="mr-2 size-4" />
				New conversation
			</Button>
		</div>
	</div>

	<!-- Messages -->
	<div bind:this={messagesContainer} class="flex-1 overflow-y-auto">
		{#if chatStore.messages.length === 0}
			<div class="flex h-full items-center justify-center">
				<div class="text-center space-y-3 px-6">
					<h2 class="text-xl font-semibold">Welcome to AI Chat</h2>
					<p class="text-muted-foreground max-w-md">
						Ask questions about the 1.4M+ documents in the Epstein investigation corpus. All
						responses include source citations.
					</p>
					<div class="pt-4 space-y-2">
						<p class="text-sm text-muted-foreground font-medium">Try asking:</p>
						<div class="space-y-1 text-sm text-muted-foreground">
							<p>"What documents mention Virginia Giuffre?"</p>
							<p>"Summarize the allegations in the court filings"</p>
							<p>"Who are the key people mentioned across the documents?"</p>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="pb-4">
				{#each chatStore.messages as message}
					<ChatMessage {message} />
				{/each}
				{#if chatStore.isStreaming}
					<div class="flex gap-3 px-6 py-4">
						<div class="max-w-[80%] rounded-lg bg-muted px-4 py-3">
							<Loader2 class="size-4 animate-spin text-muted-foreground" />
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Citations Panel -->
	<CitationPanel citations={chatStore.citations} />

	<!-- Input -->
	<ChatInput
		bind:value={chatStore.input}
		disabled={chatStore.isStreaming}
		onsubmit={handleSend}
		oninput={(value) => (chatStore.input = value)}
	/>
</div>
