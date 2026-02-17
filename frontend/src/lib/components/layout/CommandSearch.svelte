<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Search, FileText, Users, MessageCircle, GitBranch, Loader2 } from '@lucide/svelte';

	let open = $state(false);
	let query = $state('');
	let results = $state<{ id: string; name: string; type: string; subtitle?: string }[]>([]);
	let loading = $state(false);
	let selectedIndex = $state(0);

	const quickActions = [
		{ label: 'Search Documents', href: '/search', icon: Search, description: 'Full-text and semantic search' },
		{ label: 'AI Chat', href: '/chat', icon: MessageCircle, description: 'Ask questions with citations' },
		{ label: 'Graph Explorer', href: '/graph', icon: GitBranch, description: 'Visual entity relationships' },
		{ label: 'Browse Entities', href: '/entities', icon: Users, description: 'People, organizations, locations' }
	];

	onMount(() => {
		function handleKeydown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				open = !open;
			}
		}
		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	function handleInput(e: Event) {
		query = (e.target as HTMLInputElement).value;
		selectedIndex = 0;
		clearTimeout(searchTimeout);

		if (!query.trim()) {
			results = [];
			return;
		}

		searchTimeout = setTimeout(async () => {
			loading = true;
			try {
				const response = await fetch('/api/entities', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'search', query: query.trim(), limit: 8 })
				});
				const data = await response.json();
				results = (data.entities || []).map((e: { id: string; name: string; type: string }) => ({
					id: e.id,
					name: e.name,
					type: e.type,
					subtitle: e.type
				}));
			} catch {
				results = [];
			} finally {
				loading = false;
			}
		}, 200);
	}

	function handleKeydown(e: KeyboardEvent) {
		const items = query.trim() ? results : quickActions;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (query.trim() && results[selectedIndex]) {
				navigate(`/entities/${results[selectedIndex].id}`);
			} else if (!query.trim() && quickActions[selectedIndex]) {
				navigate(quickActions[selectedIndex].href);
			} else if (query.trim()) {
				navigate(`/search?q=${encodeURIComponent(query)}`);
			}
		}
	}

	function navigate(href: string) {
		open = false;
		query = '';
		results = [];
		goto(href);
	}

	function handleOpenChange(value: boolean) {
		open = value;
		if (!value) {
			query = '';
			results = [];
			selectedIndex = 0;
		}
	}
</script>

<Dialog.Root open={open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-lg gap-0 p-0 overflow-hidden">
		<div class="flex items-center border-b px-3">
			<Search class="size-4 text-muted-foreground shrink-0" />
			<input
				type="text"
				placeholder="Search entities, documents, or navigate..."
				value={query}
				oninput={handleInput}
				onkeydown={handleKeydown}
				class="flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
			/>
			{#if loading}
				<Loader2 class="size-4 animate-spin text-muted-foreground" />
			{/if}
		</div>

		<div class="max-h-[300px] overflow-y-auto p-2">
			{#if query.trim() && results.length > 0}
				<div class="text-xs font-medium text-muted-foreground px-2 py-1.5">Entities</div>
				{#each results as result, i}
					<button
						onclick={() => navigate(`/entities/${result.id}`)}
						class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors
							{i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
					>
						<Users class="size-4 shrink-0 text-muted-foreground" />
						<span class="truncate">{result.name}</span>
						<Badge variant="secondary" class="ml-auto text-xs shrink-0">{result.type}</Badge>
					</button>
				{/each}
				<button
					onclick={() => navigate(`/search?q=${encodeURIComponent(query)}`)}
					class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 mt-1"
				>
					<FileText class="size-4 shrink-0" />
					<span>Search documents for "{query}"</span>
				</button>
			{:else if query.trim() && !loading}
				<button
					onclick={() => navigate(`/search?q=${encodeURIComponent(query)}`)}
					class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent/50"
				>
					<FileText class="size-4 shrink-0 text-muted-foreground" />
					<span>Search documents for "{query}"</span>
				</button>
			{:else if !query.trim()}
				<div class="text-xs font-medium text-muted-foreground px-2 py-1.5">Quick Actions</div>
				{#each quickActions as action, i}
					<button
						onclick={() => navigate(action.href)}
						class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors
							{i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
					>
						<action.icon class="size-4 shrink-0 text-muted-foreground" />
						<span>{action.label}</span>
						<span class="ml-auto text-xs text-muted-foreground">{action.description}</span>
					</button>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
