<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { LinkPreview as HoverCardPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: HoverCardPrimitive.TriggerProps = $props();
</script>

<HoverCardPrimitive.Trigger bind:ref data-slot="hover-card-trigger" {...restProps} />
