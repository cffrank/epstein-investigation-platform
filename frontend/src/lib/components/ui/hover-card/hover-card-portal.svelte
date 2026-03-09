<script lang="ts">
import type { LinkPreview as HoverCardPrimitive } from "bits-ui";

const { ...restProps }: HoverCardPrimitive.PortalProps = $props();
</script>

<HoverCardPrimitive.Portal {...restProps} />
