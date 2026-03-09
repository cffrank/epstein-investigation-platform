<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Command as CommandPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	...restProps
}: CommandPrimitive.EmptyProps = $props();
</script>

<CommandPrimitive.Empty
	bind:ref
	data-slot="command-empty"
	class={cn("py-6 text-center text-sm", className)}
	{...restProps}
/>
