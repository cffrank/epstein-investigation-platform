<script lang="ts">
import Input from "$lib/components/ui/input/input.svelte";
import type { EntityRef } from "$lib/types";
import { cn } from "$lib/utils";
import { sanitizeDocumentText } from "$lib/utils/sanitize";
import { Search } from "@lucide/svelte";

const {
	text,
	entities,
	searchTerm = "",
}: {
	text: string;
	entities: EntityRef[];
	searchTerm?: string;
} = $props();

// biome-ignore lint/style/useConst: Svelte $state variable is bound via bind:value
let localSearchTerm = $state("");
let currentMatchIndex = $state(0);

const entityColors: Record<string, string> = {
	Person: "bg-blue-500/20 text-blue-400 border-blue-500/30",
	Organization: "bg-green-500/20 text-green-400 border-green-500/30",
	Location: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildHighlightedHtml(rawText: string, search: string): string {
	if (!rawText) return "";

	// Build entity patterns for highlighting
	const entityPatterns = entities.map((e) => ({
		name: e.name,
		type: e.type,
		pattern: new RegExp(`\\b${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
	}));

	// Collect entity matches
	const entityMatches: Array<{ index: number; length: number; entity: EntityRef }> = [];
	for (const { name, type, pattern } of entityPatterns) {
		let match: RegExpExecArray | null = null;
		pattern.lastIndex = 0;
		match = pattern.exec(rawText);
		while (match !== null) {
			entityMatches.push({
				index: match.index,
				length: match[0].length,
				entity: { id: "", name, type },
			});
			match = pattern.exec(rawText);
		}
	}
	entityMatches.sort((a, b) => a.index - b.index);

	// Build segments
	const segments: Array<{ text: string; entity?: EntityRef }> = [];
	let lastIndex = 0;
	for (const m of entityMatches) {
		if (m.index >= lastIndex) {
			if (m.index > lastIndex) {
				segments.push({ text: rawText.substring(lastIndex, m.index) });
			}
			segments.push({ text: rawText.substring(m.index, m.index + m.length), entity: m.entity });
			lastIndex = m.index + m.length;
		}
	}
	if (lastIndex < rawText.length) {
		segments.push({ text: rawText.substring(lastIndex) });
	}

	// Convert to HTML
	let html = segments
		.map((seg) => {
			if (seg.entity) {
				const colorClass = entityColors[seg.entity.type] || "";
				return `<mark class="border rounded px-0.5 ${colorClass}">${escapeHtml(seg.text)}</mark>`;
			}
			return escapeHtml(seg.text);
		})
		.join("");

	// Highlight search term
	if (search) {
		const searchPattern = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
		html = html.replace(searchPattern, '<mark class="bg-yellow-500/50 text-yellow-100">$1</mark>');
	}

	return html;
}

// Derive totalMatches separately (no state mutation)
const totalMatches = $derived.by(() => {
	if (!localSearchTerm || !text) return 0;
	const rawPattern = new RegExp(localSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
	return (text.match(rawPattern) || []).length;
});

const highlightedHtml = $derived(buildHighlightedHtml(text, localSearchTerm));

function handleSearch() {
	currentMatchIndex = 0;
}

function nextMatch() {
	if (totalMatches > 0) {
		currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
	}
}

function previousMatch() {
	if (totalMatches > 0) {
		currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
	}
}
</script>

<div class="flex h-full flex-col">
	<!-- Search bar -->
	<div class="border-b bg-background p-4">
		<div class="flex items-center gap-2">
			<div class="relative flex-1">
				<Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="text"
					placeholder="Search in document..."
					bind:value={localSearchTerm}
					oninput={handleSearch}
					class="pl-10"
				/>
			</div>
			{#if localSearchTerm && totalMatches > 0}
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">
						{currentMatchIndex + 1} / {totalMatches}
					</span>
					<button
						onclick={previousMatch}
						class="rounded-md border px-2 py-1 text-xs hover:bg-accent"
						type="button"
					>
						Previous
					</button>
					<button
						onclick={nextMatch}
						class="rounded-md border px-2 py-1 text-xs hover:bg-accent"
						type="button"
					>
						Next
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Text content -->
	<div class="flex-1 overflow-y-auto p-8">
		<div
			class={cn(
				'prose prose-invert mx-auto max-w-4xl',
				'prose-p:whitespace-pre-wrap prose-p:leading-relaxed'
			)}
		>
			{@html sanitizeDocumentText(highlightedHtml)}
		</div>
	</div>
</div>
