<script lang="ts">
import { type WithElementRef, cn } from "$lib/utils";
import type { HTMLAttributes } from "svelte/elements";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="sheet-header"
	class={cn("flex flex-col gap-1.5 p-4", className)}
	{...restProps}
>
	{@render children?.()}
</div>
