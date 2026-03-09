<script lang="ts">
import "../app.css";
import { Toaster } from "$lib/components/ui/sonner";

const { children } = $props();
</script>

{@render children()}
<Toaster richColors position="bottom-right" />
