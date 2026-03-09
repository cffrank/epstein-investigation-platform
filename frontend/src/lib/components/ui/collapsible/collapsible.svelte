<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Collapsible as CollapsiblePrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let {
	ref = $bindable(null),
	open = $bindable(false),
	...restProps
}: CollapsiblePrimitive.RootProps = $props();
</script>

<CollapsiblePrimitive.Root bind:ref bind:open data-slot="collapsible" {...restProps} />
