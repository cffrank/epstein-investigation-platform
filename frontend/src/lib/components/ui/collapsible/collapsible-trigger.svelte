<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Collapsible as CollapsiblePrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: CollapsiblePrimitive.TriggerProps = $props();
</script>

<CollapsiblePrimitive.Trigger bind:ref data-slot="collapsible-trigger" {...restProps} />
