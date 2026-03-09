<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as SheetPrimitive } from "bits-ui";

const { ...restProps }: SheetPrimitive.PortalProps = $props();
</script>

<SheetPrimitive.Portal {...restProps} />
