<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: paneforge Primitive is used as runtime value in Svelte template
import * as ResizablePrimitive from "paneforge";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	this: paneGroup = $bindable(),
	class: className,
	...restProps
}: ResizablePrimitive.PaneGroupProps & {
	this?: ResizablePrimitive.PaneGroup;
} = $props();
</script>

<ResizablePrimitive.PaneGroup
	bind:this={paneGroup}
	data-slot="resizable-pane-group"
	class={cn("flex h-full w-full data-[direction=vertical]:flex-col", className)}
	{...restProps}
/>
