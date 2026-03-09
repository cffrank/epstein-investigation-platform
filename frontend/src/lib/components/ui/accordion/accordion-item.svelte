<script lang="ts">
import { cn } from "$lib/utils";
import type { Accordion as AccordionPrimitive } from "bits-ui";

const {
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
