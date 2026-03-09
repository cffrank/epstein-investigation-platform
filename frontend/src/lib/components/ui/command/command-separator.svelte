<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Command as CommandPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	...restProps
}: CommandPrimitive.SeparatorProps = $props();
</script>

<CommandPrimitive.Separator
	bind:ref
	data-slot="command-separator"
	class={cn("bg-border -mx-1 h-px", className)}
	{...restProps}
/>
