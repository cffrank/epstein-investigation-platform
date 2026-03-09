<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Command as CommandPrimitive } from "bits-ui";

export type CommandRootApi = CommandPrimitive.Root;

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	api = $bindable(null),
	ref = $bindable(null),
	value = $bindable(""),
	class: className,
	...restProps
}: CommandPrimitive.RootProps & {
	api?: CommandRootApi | null;
} = $props();
</script>

<CommandPrimitive.Root
	bind:this={api}
	bind:value
	bind:ref
	data-slot="command"
	class={cn(
		"bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
		className
	)}
	{...restProps}
/>
