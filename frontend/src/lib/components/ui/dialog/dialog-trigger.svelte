<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as DialogPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: DialogPrimitive.TriggerProps = $props();
</script>

<DialogPrimitive.Trigger bind:ref data-slot="dialog-trigger" {...restProps} />
