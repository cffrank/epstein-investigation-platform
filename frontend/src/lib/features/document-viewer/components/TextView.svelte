<script lang="ts">
	import type { EntityRef } from '$lib/types';
	import { cn } from '$lib/utils';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Search } from '@lucide/svelte';

	let {
		text,
		entities,
		searchTerm = ''
	}: {
		text: string;
		entities: EntityRef[];
		searchTerm?: string;
	} = $props();

	let localSearchTerm = $state('');
	let currentMatchIndex = $state(0);
	let totalMatches = $state(0);

	const entityColors = {
		Person: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
		Organization: 'bg-green-500/20 text-green-400 border-green-500/30',
		Location: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
	};

	function highlightText(text: string): string {
		if (!text) return '';

		let result = text;

		// Build entity patterns for highlighting
		const entityPatterns = entities.map((e) => ({
			name: e.name,
			type: e.type,
			pattern: new RegExp(`\\b${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
		}));

		// Create segments with entity markers
		const segments: Array<{ text: string; entity?: EntityRef }> = [];
		let lastIndex = 0;
		const matches: Array<{ index: number; length: number; entity: EntityRef }> = [];

		for (const { name, type, pattern } of entityPatterns) {
			let match;
			pattern.lastIndex = 0;
			while ((match = pattern.exec(result)) !== null) {
				matches.push({
					index: match.index,
					length: match[0].length,
					entity: { id: '', name, type }
				});
			}
		}

		matches.sort((a, b) => a.index - b.index);

		for (const match of matches) {
			if (match.index >= lastIndex) {
				if (match.index > lastIndex) {
					segments.push({ text: result.substring(lastIndex, match.index) });
				}
				segments.push({
					text: result.substring(match.index, match.index + match.length),
					entity: match.entity
				});
				lastIndex = match.index + match.length;
			}
		}

		if (lastIndex < result.length) {
			segments.push({ text: result.substring(lastIndex) });
		}

		// Convert segments to HTML
		let html = segments
			.map((seg) => {
				if (seg.entity) {
					const colorClass = entityColors[seg.entity.type];
					return `<mark class="border rounded px-0.5 ${colorClass}">${escapeHtml(seg.text)}</mark>`;
				}
				return escapeHtml(seg.text);
			})
			.join('');

		// Highlight search term
		if (localSearchTerm) {
			const searchPattern = new RegExp(
				`(${localSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
				'gi'
			);
			html = html.replace(
				searchPattern,
				'<mark class="bg-yellow-500/50 text-yellow-100">$1</mark>'
			);

			// Count matches
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = html;
			totalMatches = (tempDiv.textContent?.match(searchPattern) || []).length;
		} else {
			totalMatches = 0;
		}

		return html;
	}

	function escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

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

	const highlightedHtml = $derived(highlightText(text));
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
			{@html highlightedHtml}
		</div>
	</div>
</div>
