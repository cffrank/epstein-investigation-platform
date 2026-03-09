<script lang="ts">
import { Button } from "$lib/components/ui/button";
import { ChevronLeft, ChevronRight } from "@lucide/svelte";

interface Props {
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}

const { currentPage, totalPages, onPageChange }: Props = $props();

function getPageNumbers(): (number | "ellipsis")[] {
	if (totalPages <= 7) {
		return Array.from({ length: totalPages }, (_, i) => i + 1);
	}

	const pages: (number | "ellipsis")[] = [1];

	if (currentPage > 3) {
		pages.push("ellipsis");
	}

	const start = Math.max(2, currentPage - 1);
	const end = Math.min(totalPages - 1, currentPage + 1);

	for (let i = start; i <= end; i++) {
		pages.push(i);
	}

	if (currentPage < totalPages - 2) {
		pages.push("ellipsis");
	}

	pages.push(totalPages);

	return pages;
}

const pageNumbers = $derived(getPageNumbers());
</script>

{#if totalPages > 1}
	<div class="flex items-center justify-center gap-2 py-4">
		<Button
			variant="outline"
			size="sm"
			disabled={currentPage === 1}
			onclick={() => onPageChange(currentPage - 1)}
		>
			<ChevronLeft class="h-4 w-4" />
			Previous
		</Button>

		<div class="flex items-center gap-1">
			{#each pageNumbers as page}
				{#if page === 'ellipsis'}
					<span class="px-2 text-muted-foreground">...</span>
				{:else}
					<Button
						variant={page === currentPage ? 'default' : 'outline'}
						size="sm"
						onclick={() => onPageChange(page)}
						class="min-w-[2.5rem]"
					>
						{page}
					</Button>
				{/if}
			{/each}
		</div>

		<Button
			variant="outline"
			size="sm"
			disabled={currentPage === totalPages}
			onclick={() => onPageChange(currentPage + 1)}
		>
			Next
			<ChevronRight class="h-4 w-4" />
		</Button>
	</div>
{/if}
