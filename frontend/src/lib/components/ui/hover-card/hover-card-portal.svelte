<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { LinkPreview as HoverCardPrimitive } from "bits-ui";

const { ...restProps }: HoverCardPrimitive.PortalProps = $props();
</script>

<HoverCardPrimitive.Portal {...restProps} />
