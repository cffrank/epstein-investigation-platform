<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Accordion as AccordionPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	...restProps
}: AccordionPrimitive.ItemProps = $props();
</script>

<AccordionPrimitive.Item
	bind:ref
	data-slot="accordion-item"
	class={cn("border-b last:border-b-0", className)}
	{...restProps}
/>
