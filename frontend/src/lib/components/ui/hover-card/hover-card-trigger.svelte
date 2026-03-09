<script lang="ts">
import type { LinkPreview as HoverCardPrimitive } from "bits-ui";

const { ref = $bindable(null), ...restProps }: HoverCardPrimitive.TriggerProps = $props();
</script>

<HoverCardPrimitive.Trigger bind:ref data-slot="hover-card-trigger" {...restProps} />
