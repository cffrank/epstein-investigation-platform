<script lang="ts">
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import CitationPanel from "$lib/features/chat/components/CitationPanel.svelte";
import ToolCallPanel from "$lib/features/chat/components/ToolCallPanel.svelte";
import { parseSSE } from "$lib/features/chat/sse";
import type { EntityBiography, NativeCitation, ToolCall } from "$lib/types";
import { sanitizeChatContent } from "$lib/utils/sanitize";
import { RefreshCw, Sparkles } from "@lucide/svelte";

interface Props {
	entityId: string;
	entityName: string;
	biography: EntityBiography | null;
}

const { entityId, entityName, biography }: Props = $props();

let currentBio = $state<EntityBiography | null>(biography);
let isGenerating = $state(false);
let streamedContent = $state("");
let toolCalls = $state<ToolCall[]>([]);
let citations = $state<NativeCitation[]>([]);
let errorMsg = $state<string | null>(null);

function formatDate(dateStr: string): string {
	try {
		return new Date(dateStr).toLocaleDateString("en-US", {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch {
		return dateStr;
	}
}

async function generateBiography() {
	isGenerating = true;
	streamedContent = "";
	toolCalls = [];
	citations = [];
	errorMsg = null;

	try {
		const response = await fetch(`/api/entities/${entityId}/biography`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: entityName }),
		});

		if (!response.ok || !response.body) {
			throw new Error("Biography generation failed");
		}

		for await (const event of parseSSE(response.body)) {
			switch (event.event) {
				case "text_delta": {
					const data = JSON.parse(event.data) as { text: string };
					streamedContent += data.text;
					break;
				}
				case "tool_call": {
					const data = JSON.parse(event.data) as { id: string; name: string };
					toolCalls = [...toolCalls, { id: data.id, name: data.name, status: "running" as const }];
					break;
				}
				case "tool_result": {
					const data = JSON.parse(event.data) as {
						id: string;
						status: string;
						resultCount?: number;
					};
					const tc = toolCalls.find((t) => t.id === data.id);
					if (tc) {
						tc.status = (data.status as "complete" | "error") || "complete";
						tc.resultCount = data.resultCount;
					}
					toolCalls = [...toolCalls];
					break;
				}
				case "citations_delta": {
					const data = JSON.parse(event.data) as { citation: NativeCitation };
					citations = [...citations, data.citation];
					break;
				}
				case "done":
					currentBio = {
						content: streamedContent,
						generated_at: new Date().toISOString(),
						model: "claude-sonnet-4-6",
						citations: citations.length > 0 ? citations : undefined,
					};
					break;
				case "error": {
					const data = JSON.parse(event.data) as { message: string };
					errorMsg = data.message;
					break;
				}
			}
		}
	} catch (e) {
		errorMsg = e instanceof Error ? e.message : "Unknown error";
	} finally {
		isGenerating = false;
	}
}
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-xl font-semibold mb-4">AI Biography</h2>
		<p class="text-sm text-muted-foreground mb-4">
			Claude-generated synthesis of corpus mentions
		</p>
	</div>

	{#if isGenerating}
		<!-- Generating state -->
		<Card.Root>
			<Card.Content class="pt-6 space-y-4">
				{#if toolCalls.length > 0}
					<ToolCallPanel {toolCalls} />
				{/if}
				{#if streamedContent}
					<div class="whitespace-pre-wrap break-words text-sm">
						{@html sanitizeChatContent(streamedContent)}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground animate-pulse">
						Generating biography...
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else if currentBio}
		<!-- Cached biography display -->
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs text-muted-foreground">
				Generated on {formatDate(currentBio.generated_at)} using {currentBio.model}
			</span>
			<Button variant="outline" size="sm" onclick={generateBiography} class="gap-2">
				<RefreshCw class="size-3.5" />
				Regenerate
			</Button>
		</div>

		<Card.Root>
			<Card.Content class="pt-6">
				<div class="whitespace-pre-wrap break-words text-sm">
					{@html sanitizeChatContent(currentBio.content)}
				</div>
			</Card.Content>
		</Card.Root>

		{#if currentBio.citations && currentBio.citations.length > 0}
			<CitationPanel citations={currentBio.citations} />
		{/if}

		<p class="text-xs text-muted-foreground italic">
			AI-generated biography · verify claims against source documents
		</p>
	{:else}
		<!-- No biography yet -->
		<Card.Root>
			<Card.Content class="py-8 text-center space-y-4">
				<p class="text-muted-foreground">
					No biography generated yet for this entity.
				</p>
				<p class="text-sm text-muted-foreground">
					Claude will search the document corpus and synthesize a comprehensive profile.
				</p>
				<Button variant="default" onclick={generateBiography} class="gap-2">
					<Sparkles class="size-4" />
					Generate Biography
				</Button>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if errorMsg}
		<Card.Root class="border-destructive">
			<Card.Content class="pt-6">
				<p class="text-sm text-destructive">Error: {errorMsg}</p>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
