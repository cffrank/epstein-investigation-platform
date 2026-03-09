<script lang="ts">
import { Textarea } from "$lib/components/ui/textarea";
import { Send } from "@lucide/svelte";

interface Props {
	value: string;
	disabled?: boolean;
	onsubmit: (value: string) => void;
	oninput: (value: string) => void;
}

const { value = $bindable(), disabled = false, onsubmit, oninput }: Props = $props();

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		if (value.trim() && !disabled) {
			onsubmit(value);
		}
	}
}

function handleSubmit() {
	if (value.trim() && !disabled) {
		onsubmit(value);
	}
}
</script>

<div class="border-t border-border bg-background p-4">
	<div class="relative">
		<Textarea
			bind:value
			oninput={(e: Event) => oninput((e.currentTarget as HTMLTextAreaElement).value)}
			onkeydown={handleKeydown}
			placeholder="Ask a question about the documents..."
			{disabled}
			class="min-h-[80px] pr-12 resize-none"
		/>
		<button
			onclick={handleSubmit}
			disabled={disabled || !value.trim()}
			class="absolute bottom-3 right-3 rounded-lg bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
			aria-label="Send message"
		>
			<Send class="size-4" />
		</button>
	</div>
	<div class="mt-2 text-xs text-muted-foreground">
		Press <kbd class="rounded bg-muted px-1.5 py-0.5">⌘</kbd> + <kbd
			class="rounded bg-muted px-1.5 py-0.5">Enter</kbd
		> to send
	</div>
</div>
