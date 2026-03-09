<script lang="ts">
import { page } from "$app/stores";
import { Button } from "$lib/components/ui/button";
import ChatInput from "$lib/features/chat/components/ChatInput.svelte";
import ChatMessage from "$lib/features/chat/components/ChatMessage.svelte";
import CitationPanel from "$lib/features/chat/components/CitationPanel.svelte";
import ModelSelector from "$lib/features/chat/components/ModelSelector.svelte";
import { chatStore } from "$lib/features/chat/stores.svelte";
import { Loader2, Plus } from "@lucide/svelte";

let messagesContainer: HTMLDivElement;

// Pre-fill chat input from entity dossier page (?entity=NAME)
$effect(() => {
	const entityParam = $page.url.searchParams.get("entity");
	if (entityParam && !chatStore.messages.length) {
		chatStore.input = `Tell me about ${entityParam}`;
	}
});

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

// Get citations from last assistant message
const lastAssistantCitations = $derived(() => {
	const assistantMessages = chatStore.messages.filter((m) => m.role === "assistant");
	const last = assistantMessages[assistantMessages.length - 1];
	return last?.citations ?? [];
});
</script>

<div class="flex h-[calc(100vh-4rem)] flex-col">
	<!-- Header -->
	<div class="border-b border-border px-6 py-4">
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold">AI Chat</h1>
				<p class="text-sm text-muted-foreground">
					Ask questions about the 960K+ documents in the Epstein investigation corpus
				</p>
			</div>
			<div class="flex items-center gap-3">
				<ModelSelector
					value={chatStore.selectedModel}
					onchange={(model) => (chatStore.selectedModel = model)}
					disabled={chatStore.isStreaming}
				/>
				<Button variant="outline" onclick={handleClear} disabled={chatStore.isStreaming}>
					<Plus class="mr-2 size-4" />
					New conversation
				</Button>
			</div>
		</div>
	</div>

	<!-- Messages -->
	<div bind:this={messagesContainer} class="flex-1 overflow-y-auto">
		{#if chatStore.messages.length === 0}
			<div class="flex h-full items-center justify-center">
				<div class="text-center space-y-3 px-6">
					<h2 class="text-xl font-semibold">Welcome to AI Chat</h2>
					<p class="text-muted-foreground max-w-md">
						Claude will search documents, query entities, and traverse the knowledge
						graph. All responses include source citations.
					</p>
					<div class="pt-4 space-y-2">
						<p class="text-sm text-muted-foreground font-medium">Try asking:</p>
						<div class="space-y-1 text-sm text-muted-foreground">
							<p>"What documents mention Virginia Giuffre?"</p>
							<p>"Find connections between Jeffrey Epstein and Les Wexner"</p>
							<p>"Who are the key people mentioned across the flight logs?"</p>
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
					{@const lastMsg = chatStore.messages[chatStore.messages.length - 1]}
					{#if lastMsg?.role === 'assistant' && !lastMsg.content && !lastMsg.toolCalls?.length}
						<div class="flex gap-3 px-6 py-4">
							<div class="max-w-[80%] rounded-lg bg-muted px-4 py-3">
								<Loader2 class="size-4 animate-spin text-muted-foreground" />
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<!-- Citations Panel -->
	{#if lastAssistantCitations().length > 0}
		<CitationPanel citations={lastAssistantCitations()} />
	{/if}

	<!-- Input -->
	<ChatInput
		bind:value={chatStore.input}
		disabled={chatStore.isStreaming}
		onsubmit={handleSend}
		oninput={(value) => (chatStore.input = value)}
	/>
</div>
