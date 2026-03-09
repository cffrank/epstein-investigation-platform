<script lang="ts">
	import type { ModelKey } from '$lib/types';

	interface Props {
		value: ModelKey;
		onchange: (model: ModelKey) => void;
		disabled?: boolean;
	}

	let { value, onchange, disabled = false }: Props = $props();

	const models: Array<{ key: ModelKey; label: string; hint: string }> = [
		{ key: 'haiku-4.5', label: 'Haiku 4.5', hint: 'Fast · Simple lookups' },
		{ key: 'sonnet-4.6', label: 'Sonnet 4.6', hint: 'Fast · Good for most' },
		{ key: 'opus-4.6', label: 'Opus 4.6', hint: 'Deep analysis · Slower' },
	];

	function handleChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		onchange(target.value as ModelKey);
	}

	const currentLabel = $derived(models.find((m) => m.key === value)?.label || value);
</script>

<div class="relative">
	<select
		{disabled}
		onchange={handleChange}
		class="appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
	>
		{#each models as model}
			<option value={model.key} selected={model.key === value}>
				{model.label} — {model.hint}
			</option>
		{/each}
	</select>
	<div
		class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-muted-foreground"
	>
		<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"
			></path>
		</svg>
	</div>
</div>
