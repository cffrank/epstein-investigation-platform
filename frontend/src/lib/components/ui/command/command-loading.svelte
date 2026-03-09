<script lang="ts">
// biome-ignore lint/style/useImportType: bits-ui Primitive is used as runtime value in Svelte template
import { Command as CommandPrimitive } from "bits-ui";

// biome-ignore lint/style/useConst: Svelte $bindable props must use let, not const
let { ref = $bindable(null), ...restProps }: CommandPrimitive.LoadingProps = $props();
</script>

<CommandPrimitive.Loading bind:ref {...restProps} />
