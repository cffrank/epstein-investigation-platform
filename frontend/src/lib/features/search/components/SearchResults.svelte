<script lang="ts">
import { Badge } from "$lib/components/ui/badge";
import { Card } from "$lib/components/ui/card";
import type { SearchResult } from "$lib/types";
import { entityColor, truncate } from "$lib/utils";
import { sanitizeSearchSnippet } from "$lib/utils/sanitize";
import { FileText } from "@lucide/svelte";

interface Props {
	results: SearchResult[];
	loading?: boolean;
}

const { results, loading = false }: Props = $props();

function formatDate(dateStr: string | null): string {
	if (!dateStr) return "Unknown date";
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
</script>

{#if loading}
	<div class="space-y-4">
		{#each Array(5) as _}
			<Card class="animate-pulse">
				<div class="p-4">
					<div class="h-6 bg-muted rounded w-3/4 mb-2"></div>
					<div class="h-4 bg-muted rounded w-1/4 mb-3"></div>
					<div class="h-4 bg-muted rounded w-full mb-2"></div>
					<div class="h-4 bg-muted rounded w-5/6"></div>
				</div>
			</Card>
		{/each}
	</div>
{:else if results.length > 0}
	<div class="space-y-4">
		{#each results as result}
			<a href="/documents/{result.id}" class="block">
				<Card class="hover:shadow-md transition-shadow cursor-pointer">
					<div class="p-4 flex items-start gap-3">
						<FileText class="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
						<div class="flex-1 min-w-0">
							<h3 class="font-semibold text-lg mb-1 truncate" title={result.filename}>
								{result.filename}
							</h3>
							<div class="flex items-center gap-2 mb-2 flex-wrap">
								<Badge variant="secondary">{result.source}</Badge>
								{#if result.doc_type}
									<Badge variant="outline">{result.doc_type}</Badge>
								{/if}
								<span class="text-xs text-muted-foreground">
									{formatDate(result.date)}
								</span>
								<span class="text-xs text-muted-foreground">
									Score: {result.score.toFixed(3)}
								</span>
							</div>
							{#if result.entities && result.entities.length > 0}
								<div class="flex items-center gap-1 mt-1 flex-wrap">
									{#each result.entities.slice(0, 3) as entity}
										<Badge
											variant="outline"
											class="text-xs"
											style="border-color: {entityColor(entity.type)}; color: {entityColor(entity.type)}"
										>
											{entity.name}
										</Badge>
									{/each}
									{#if result.entities.length > 3}
										<span class="text-xs text-muted-foreground">+{result.entities.length - 3} more</span>
									{/if}
								</div>
							{/if}
							<div class="text-sm text-muted-foreground prose prose-sm max-w-none">
								{@html sanitizeSearchSnippet(result.snippet || truncate(result.filename, 200))}
							</div>
						</div>
					</div>
				</Card>
			</a>
		{/each}
	</div>
{:else}
	<div class="text-center py-12">
		<FileText class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
		<h3 class="text-lg font-semibold mb-2">No results found</h3>
		<p class="text-muted-foreground">Try adjusting your search query or filters</p>
	</div>
{/if}
