import { query as dbQuery } from "$lib/server/db";
import { neo4jClient } from "$lib/server/neo4j";
import type {
	Document,
	EntityBiography,
	EntityCoOccurrence,
	EntityConnection,
	EntityType,
	InvestigationNote,
	TimelineEvent,
} from "$lib/types";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, platform }) => {
	if (!platform?.env) {
		throw error(500, "Platform unavailable in dev mode");
	}

	const { id } = params;

	if (!id || !/^\d+$/.test(id)) {
		throw error(400, "Invalid entity ID");
	}

	try {
		const neo4j = neo4jClient(platform);
		const entityId = Number.parseInt(id, 10);

		// Fetch entity profile with connections and aliases
		const profileCypher = `
			MATCH (e) WHERE id(e) = toInteger($id)
			OPTIONAL MATCH (e)-[r]-(connected)
			WHERE connected:Person OR connected:Organization OR connected:Location
			WITH e, collect({
			  id: id(connected),
			  name: connected.name,
			  type: labels(connected)[0],
			  rel: type(r)
			}) as connections
			RETURN e.name as name,
			       labels(e)[0] as type,
			       e.aliases as aliases,
			       connections
		`;

		const profileResult = await neo4j.query(profileCypher, { id: entityId });

		if (!profileResult.rows.length) {
			throw error(404, "Entity not found");
		}

		const [name, type, aliasesRaw, connectionsRaw] = profileResult.rows[0];

		// Filter out null connections and map to proper type
		const connections: EntityConnection[] = (
			connectionsRaw as Array<{
				id: number;
				name: string;
				type: string;
				rel: string;
			}>
		)
			.filter((c) => c.id !== null && c.name !== null)
			.map((c) => ({
				id: String(c.id),
				name: c.name,
				type: c.type as EntityType,
				relationship_type: c.rel,
			}));

		// Fetch documents mentioning this entity
		const docsCypher = `
			MATCH (e)-[:MENTIONED_IN]->(d:Document)
			WHERE id(e) = toInteger($id)
			RETURN d.doc_id as doc_id, d.name as name
			ORDER BY d.name
			LIMIT 50
		`;

		const docsResult = await neo4j.query(docsCypher, { id: entityId });
		const docIds = docsResult.rows.map((row) => row[0] as string).filter((docId) => docId !== null);

		// Fetch document metadata from PostgreSQL
		let documents: Document[] = [];
		if (docIds.length > 0) {
			const docsSql = `
				SELECT id, filename, source, doc_type, file_size_bytes, created_at
				FROM documents
				WHERE id = ANY($1)
				ORDER BY filename
			`;

			const docs = await dbQuery<{
				id: string;
				filename: string;
				source: string;
				doc_type: string | null;
				file_size_bytes: number | null;
				created_at: string;
			}>(platform, docsSql, [docIds]);

			documents = docs.map((doc) => ({
				id: doc.id,
				filename: doc.filename,
				source: doc.source,
				doc_type: doc.doc_type,
				file_size_bytes: doc.file_size_bytes,
				r2_key: null,
				text: null,
				page_count: null,
				content_hash: null,
				created_at: doc.created_at,
			}));
		}

		// Fetch co-occurring entities
		const coOccurrencesCypher = `
			MATCH (e)-[:MENTIONED_IN]->(d:Document)<-[:MENTIONED_IN]-(other)
			WHERE id(e) = toInteger($id)
			  AND id(e) <> id(other)
			  AND (other:Person OR other:Organization OR other:Location)
			RETURN id(other) as id,
			       other.name as name,
			       labels(other)[0] as type,
			       count(DISTINCT d) as shared_docs
			ORDER BY shared_docs DESC
			LIMIT 20
		`;

		const coOccurrencesResult = await neo4j.query(coOccurrencesCypher, { id: entityId });

		const co_occurrences: EntityCoOccurrence[] = coOccurrencesResult.rows.map((row) => ({
			id: String(row[0]),
			name: row[1] as string,
			type: row[2] as EntityType,
			shared_docs: row[3] as number,
		}));

		// Fetch timeline events from Neo4j (Event nodes connected to entity)
		let timeline_events: TimelineEvent[] = [];
		try {
			const timelineCypher = `
				MATCH (e)-[:PARTICIPATED_IN|OCCURRED_AT|RELATED_TO]-(event:Event)
				WHERE id(e) = toInteger($id)
				RETURN id(event) as id, event.date as date, event.description as description,
				       event.type as event_type, null as doc_id, null as doc_name
				ORDER BY event.date
				LIMIT 50
			`;
			const timelineResult = await neo4j.query(timelineCypher, { id: entityId });
			timeline_events = timelineResult.rows.map((row) => ({
				id: String(row[0]),
				date: (row[1] as string) || "",
				description: (row[2] as string) || "",
				document_id: row[3] as string | null,
				document_name: row[4] as string | null,
				event_type: (row[5] as string) || "event",
			}));
		} catch {
			// Event nodes may not exist yet (Phase 6 creates them)
			timeline_events = [];
		}

		// Fetch investigation notes from PostgreSQL
		let notes: InvestigationNote[] = [];
		try {
			notes = await dbQuery<InvestigationNote>(
				platform,
				"SELECT id, entity_id, content, created_at, updated_at FROM entity_notes WHERE entity_id = $1 ORDER BY created_at DESC",
				[id],
			);
		} catch {
			// Table may not exist yet
			notes = [];
		}

		// Fetch cached biography from PostgreSQL entities table
		let biography: EntityBiography | null = null;
		try {
			const bioResult = await dbQuery<{
				description: string | null;
				biography: string | null;
				biography_generated_at: string | null;
				biography_model: string | null;
			}>(
				platform,
				`SELECT description, biography, biography_generated_at, biography_model
				 FROM entities
				 WHERE canonical_name ILIKE $1
				 LIMIT 1`,
				[name as string],
			);
			if (bioResult.length > 0 && bioResult[0].biography_generated_at) {
				biography = {
					content: bioResult[0].biography || bioResult[0].description || "",
					generated_at: bioResult[0].biography_generated_at,
					model: bioResult[0].biography_model || "unknown",
				};
			}
		} catch {
			// Biography columns may not exist yet
			biography = null;
		}

		const aliases = (aliasesRaw as string[] | null) || [];

		return {
			id,
			name: name as string,
			type: type as EntityType,
			aliases,
			connections,
			documents,
			co_occurrences,
			document_count: documents.length,
			connection_count: connections.length,
			biography,
			notes,
			timeline_events,
		};
	} catch (err) {
		console.error("Entity profile load error:", err);
		if ((err as { status?: number }).status) {
			throw err;
		}
		throw error(500, "Failed to load entity profile");
	}
};
