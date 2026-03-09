<script lang="ts">
import { Separator } from "$lib/components/ui/separator";
import * as Tabs from "$lib/components/ui/tabs";
import {
	BiographyTab,
	ConnectionsTab,
	DocumentsTab,
	DossierHeader,
	NotesTab,
	TimelineTab,
} from "$lib/features/entities/components";
import type { PageData } from "./$types";

const { data }: { data: PageData } = $props();
</script>

<div class="container mx-auto p-6 space-y-6">
	<!-- Header -->
	<DossierHeader
		name={data.name}
		type={data.type}
		aliases={data.aliases}
		documentCount={data.document_count}
		connectionCount={data.connection_count}
	/>

	<Separator />

	<!-- Tabs -->
	<Tabs.Root value="documents">
		<Tabs.List>
			<Tabs.Trigger value="documents">Documents ({data.documents.length})</Tabs.Trigger>
			<Tabs.Trigger value="connections">Connections ({data.connections.length})</Tabs.Trigger>
			<Tabs.Trigger value="timeline">Timeline ({data.timeline_events.length})</Tabs.Trigger>
			<Tabs.Trigger value="biography">Biography</Tabs.Trigger>
			<Tabs.Trigger value="notes">Notes ({data.notes.length})</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="documents" class="mt-6">
			<DocumentsTab documents={data.documents} />
		</Tabs.Content>

		<Tabs.Content value="connections" class="mt-6">
			<ConnectionsTab
				connections={data.connections}
				coOccurrences={data.co_occurrences}
			/>
		</Tabs.Content>

		<Tabs.Content value="timeline" class="mt-6">
			<TimelineTab events={data.timeline_events} />
		</Tabs.Content>

		<Tabs.Content value="biography" class="mt-6">
			<BiographyTab
				entityId={data.id}
				entityName={data.name}
				biography={data.biography}
			/>
		</Tabs.Content>

		<Tabs.Content value="notes" class="mt-6">
			<NotesTab
				entityId={data.id}
				initialNotes={data.notes}
			/>
		</Tabs.Content>
	</Tabs.Root>
</div>
