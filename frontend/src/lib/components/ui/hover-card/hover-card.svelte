<script lang="ts">
import type { LinkPreview as HoverCardPrimitive } from "bits-ui";

const { open = $bindable(false), ...restProps }: HoverCardPrimitive.RootProps = $props();
</script>

<HoverCardPrimitive.Root bind:open {...restProps} />
