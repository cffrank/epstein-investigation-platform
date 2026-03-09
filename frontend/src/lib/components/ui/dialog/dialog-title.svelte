<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as DialogPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	class: className,
	...restProps
}: DialogPrimitive.TitleProps = $props();
</script>

<DialogPrimitive.Title
	bind:ref
	data-slot="dialog-title"
	class={cn("text-lg leading-none font-semibold", className)}
	{...restProps}
/>
