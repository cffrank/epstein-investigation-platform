<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import CommandSearch from '$lib/components/layout/CommandSearch.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Menu, FileText } from '@lucide/svelte';

	let { children } = $props();
	let sidebarCollapsed = $state(false);
	let mobileOpen = $state(false);

	// Close mobile nav on navigation
	afterNavigate(() => {
		mobileOpen = false;
	});
</script>

<!-- Mobile header -->
<div class="flex h-12 items-center gap-2 border-b border-border px-3 md:hidden">
	<Sheet.Root bind:open={mobileOpen}>
		<Sheet.Trigger>
			{#snippet child({ props })}
				<Button variant="ghost" size="icon" {...props}>
					<Menu class="size-5" />
				</Button>
			{/snippet}
		</Sheet.Trigger>
		<Sheet.Content side="left" class="w-60 p-0">
			<Sheet.Header class="sr-only">
				<Sheet.Title>Navigation</Sheet.Title>
			</Sheet.Header>
			<Sidebar />
		</Sheet.Content>
	</Sheet.Root>
	<FileText class="size-4 text-primary" />
	<span class="font-semibold text-sm">Epstein Files</span>
</div>

<div class="flex h-[calc(100vh-48px)] md:h-screen overflow-hidden">
	<div class="hidden md:block">
		<Sidebar collapsed={sidebarCollapsed} onToggle={() => (sidebarCollapsed = !sidebarCollapsed)} />
	</div>
	<main class="flex-1 overflow-y-auto">
		{@render children()}
	</main>
</div>

<CommandSearch />
