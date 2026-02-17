<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { AlertTriangle } from '@lucide/svelte';
</script>

<div class="flex h-screen items-center justify-center">
	<div class="text-center space-y-4 px-6">
		<AlertTriangle class="size-12 text-destructive mx-auto" />
		<h1 class="text-4xl font-bold">{page.status}</h1>
		<p class="text-muted-foreground max-w-md">
			{page.error?.message || 'Something went wrong'}
		</p>
		<div class="flex gap-2 justify-center pt-2">
			<Button variant="outline" onclick={() => history.back()}>Go Back</Button>
			<Button href="/search">Home</Button>
		</div>
	</div>
</div>
