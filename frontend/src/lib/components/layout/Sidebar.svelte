<script lang="ts">
import { page } from "$app/state";
import { Command, FileText, GitBranch, MessageCircle, Search, Users } from "@lucide/svelte";

interface Props {
	collapsed?: boolean;
	onToggle?: () => void;
}

const { collapsed = false, onToggle }: Props = $props();

const navItems = [
	{ href: "/search", label: "Search", icon: Search },
	{ href: "/chat", label: "AI Chat", icon: MessageCircle },
	{ href: "/graph", label: "Graph", icon: GitBranch },
	{ href: "/entities", label: "Entities", icon: Users },
];

function isActive(href: string): boolean {
	return page.url.pathname.startsWith(href);
}
</script>

<aside
	class="flex h-full flex-col border-r border-border bg-card transition-all duration-200
		{collapsed ? 'w-16' : 'w-60'}"
>
	<div class="flex h-14 items-center border-b border-border px-4 gap-2">
		<FileText class="size-5 shrink-0 text-primary" />
		{#if !collapsed}
			<a href="/search" class="text-lg font-semibold tracking-tight truncate">Epstein Files</a>
		{/if}
	</div>

	<nav class="flex-1 space-y-1 p-2">
		{#each navItems as item}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors
					{isActive(item.href)
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
				title={collapsed ? item.label : undefined}
			>
				<item.icon class="size-4 shrink-0" />
				{#if !collapsed}
					{item.label}
				{/if}
			</a>
		{/each}
	</nav>

	{#if !collapsed}
		<div class="border-t border-border p-3">
			<button
				onclick={() => {
					const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
					document.dispatchEvent(event);
				}}
				class="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
			>
				<Search class="size-3" />
				<span>Quick search</span>
				<kbd class="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
					<Command class="inline size-2.5" />K
				</kbd>
			</button>
		</div>
		<div class="border-t border-border p-4 text-xs text-muted-foreground">
			<p>1.47M documents</p>
			<p>217K entities</p>
		</div>
	{/if}
</aside>
