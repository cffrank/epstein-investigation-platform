<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Dialog as DialogPrimitive } from "bits-ui";

const { ...restProps }: DialogPrimitive.PortalProps = $props();
</script>

<DialogPrimitive.Portal {...restProps} />
