<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as SheetPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: SheetPrimitive.TriggerProps = $props();
</script>

<SheetPrimitive.Trigger bind:ref data-slot="sheet-trigger" {...restProps} />
