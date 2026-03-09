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
	data-slot="dialog-header"
	class={cn("flex flex-col gap-2 text-center sm:text-start", className)}
	{...restProps}
>
	{@render children?.()}
</div>
