<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as DialogPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: DialogPrimitive.CloseProps = $props();
</script>

<DialogPrimitive.Close bind:ref data-slot="dialog-close" {...restProps} />
