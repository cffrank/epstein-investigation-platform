<script lang="ts">
import { type WithoutChild, cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Accordion as AccordionPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: WithoutChild<AccordionPrimitive.ContentProps> = $props();
</script>

<AccordionPrimitive.Content
	bind:ref
	data-slot="accordion-content"
	class="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
	{...restProps}
>
	<div class={cn("pt-0 pb-4", className)}>
		{@render children?.()}
	</div>
</AccordionPrimitive.Content>
