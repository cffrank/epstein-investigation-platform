<script lang="ts">
import { cn } from "$lib/utils";
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as SheetPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), class: className, ...restProps }: SheetPrimitive.TitleProps = $props();
</script>

<SheetPrimitive.Title
	bind:ref
	data-slot="sheet-title"
	class={cn("text-foreground font-semibold", className)}
	{...restProps}
/>
