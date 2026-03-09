<script lang="ts">
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		initialContent?: string;
		onSave: (content: string) => Promise<void>;
		onCancel: () => void;
		saving?: boolean;
	}

	let { initialContent = '', onSave, onCancel, saving = false }: Props = $props();
	let content = $state(initialContent);
</script>

<div class="space-y-2">
	<Textarea
		bind:value={content}
		placeholder="Write your observation..."
		rows={3}
		class="resize-none"
		disabled={saving}
	/>
	<div class="flex items-center gap-2">
		<Button
			variant="default"
			size="sm"
			onclick={() => onSave(content)}
			disabled={!content.trim() || saving}
		>
			{saving ? 'Saving...' : 'Save'}
		</Button>
		<Button variant="ghost" size="sm" onclick={onCancel} disabled={saving}>
			Cancel
		</Button>
	</div>
</div>
