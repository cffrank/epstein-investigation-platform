<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Accordion as AccordionPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	value = $bindable(),
	...restProps
}: AccordionPrimitive.RootProps = $props();
</script>

<AccordionPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="accordion"
	{...restProps}
/>
