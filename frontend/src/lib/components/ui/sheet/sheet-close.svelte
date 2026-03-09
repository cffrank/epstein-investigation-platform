<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as SheetPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: SheetPrimitive.CloseProps = $props();
</script>

<SheetPrimitive.Close bind:ref data-slot="sheet-close" {...restProps} />
