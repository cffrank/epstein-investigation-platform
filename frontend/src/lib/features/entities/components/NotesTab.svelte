<script lang="ts">
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import type { InvestigationNote } from "$lib/types";
import { Pencil, Plus, Trash2 } from "@lucide/svelte";
import NoteEditor from "./NoteEditor.svelte";

interface Props {
	entityId: string;
	initialNotes: InvestigationNote[];
}

const { entityId, initialNotes }: Props = $props();

let notes = $state<InvestigationNote[]>(initialNotes);
let isAdding = $state(false);
let editingId = $state<string | null>(null);
let deletingId = $state<string | null>(null);
let saving = $state(false);

async function createNote(content: string) {
	saving = true;
	try {
		const res = await fetch(`/api/entities/${entityId}/notes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content }),
		});
		if (!res.ok) throw new Error("Failed to create note");
		const note = (await res.json()) as InvestigationNote;
		notes = [note, ...notes];
		isAdding = false;
	} finally {
		saving = false;
	}
}

async function updateNote(noteId: string, content: string) {
	saving = true;
	try {
		const res = await fetch(`/api/entities/${entityId}/notes`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ note_id: noteId, content }),
		});
		if (!res.ok) throw new Error("Failed to update note");
		const updated = (await res.json()) as InvestigationNote;
		notes = notes.map((n) => (n.id === noteId ? updated : n));
		editingId = null;
	} finally {
		saving = false;
	}
}

async function deleteNote(noteId: string) {
	saving = true;
	try {
		const res = await fetch(`/api/entities/${entityId}/notes`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ note_id: noteId }),
		});
		if (!res.ok) throw new Error("Failed to delete note");
		notes = notes.filter((n) => n.id !== noteId);
		deletingId = null;
	} finally {
		saving = false;
	}
}

function formatTimestamp(dateStr: string): string {
	try {
		return new Date(dateStr).toLocaleString();
	} catch {
		return dateStr;
	}
}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-xl font-semibold">Investigation Notes</h2>
			<p class="text-sm text-muted-foreground">Quick observations and annotations</p>
		</div>
		{#if !isAdding}
			<Button variant="default" size="sm" onclick={() => (isAdding = true)} class="gap-2">
				<Plus class="size-4" />
				Add Note
			</Button>
		{/if}
	</div>

	{#if isAdding}
		<Card.Root>
			<Card.Content class="pt-6">
				<NoteEditor
					onSave={createNote}
					onCancel={() => (isAdding = false)}
					{saving}
				/>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if notes.length === 0 && !isAdding}
		<Card.Root>
			<Card.Content class="py-8 text-center text-muted-foreground">
				No investigation notes yet. Add one to start tracking observations.
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="space-y-3">
			{#each notes as note}
				<Card.Root>
					<Card.Content class="pt-6">
						{#if editingId === note.id}
							<NoteEditor
								initialContent={note.content}
								onSave={(content) => updateNote(note.id, content)}
								onCancel={() => (editingId = null)}
								{saving}
							/>
						{:else if deletingId === note.id}
							<div class="space-y-3">
								<p class="text-sm">{note.content}</p>
								<div class="flex items-center gap-2 rounded-md bg-destructive/10 p-3">
									<span class="text-sm font-medium text-destructive">
										Are you sure you want to delete this note?
									</span>
									<Button
										variant="destructive"
										size="sm"
										onclick={() => deleteNote(note.id)}
										disabled={saving}
									>
										Delete
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => (deletingId = null)}
									>
										Cancel
									</Button>
								</div>
							</div>
						{:else}
							<div class="space-y-2">
								<p class="text-sm whitespace-pre-wrap">{note.content}</p>
								<div class="flex items-center justify-between">
									<span class="text-xs text-muted-foreground">
										{formatTimestamp(note.created_at)}
										{#if note.updated_at !== note.created_at}
											(edited {formatTimestamp(note.updated_at)})
										{/if}
									</span>
									<div class="flex items-center gap-1">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0"
											onclick={() => (editingId = note.id)}
										>
											<Pencil class="size-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-destructive hover:text-destructive"
											onclick={() => (deletingId = note.id)}
										>
											<Trash2 class="size-3.5" />
										</Button>
									</div>
								</div>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
