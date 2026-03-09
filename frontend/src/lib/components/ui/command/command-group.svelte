<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Command as CommandPrimitive, useId } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	children,
	heading,
	value,
	...restProps
}: CommandPrimitive.GroupProps & {
	heading?: string;
} = $props();
</script>

<CommandPrimitive.Group
	bind:ref
	data-slot="command-group"
	class={cn("text-foreground overflow-hidden p-1", className)}
	value={value ?? heading ?? `----${useId()}`}
	{...restProps}
>
	{#if heading}
		<CommandPrimitive.GroupHeading
			class="text-muted-foreground px-2 py-1.5 text-xs font-medium"
		>
			{heading}
		</CommandPrimitive.GroupHeading>
	{/if}
	<CommandPrimitive.GroupItems {children} />
</CommandPrimitive.Group>
