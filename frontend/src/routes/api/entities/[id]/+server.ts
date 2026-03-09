import { query as dbQuery } from "$lib/server/db";
import { neo4jClient } from "$lib/server/neo4j";
import type {
	Document,
	EntityCoOccurrence,
	EntityConnection,
	EntityProfile,
	EntityType,
} from "$lib/types";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, platform }) => {
	if (!platform?.env) {
		return json({ error: "Platform unavailable in dev mode" }, { status: 500 });
	}

	const { id } = params;

	if (!id || !/^\d+$/.test(id)) {
		return json({ error: "Invalid entity ID" }, { status: 400 });
	}

	try {
		const neo4j = neo4jClient(platform);
		const entityId = Number.parseInt(id, 10);

		// Fetch entity profile with connections
		const profileCypher = `
			MATCH (e) WHERE id(e) = toInteger($id)
			OPTIONAL MATCH (e)-[r]-(connected)
			WHERE connected:Person OR connected:Organization OR connected:Location
			RETURN e.name as name,
			       labels(e)[0] as type,
			       collect({
			         id: id(connected),
			         name: connected.name,
			         type: labels(connected)[0],
			         rel: type(r)
			       }) as connections
		`;

		const profileResult = await neo4j.query(profileCypher, { id: entityId });

		if (!profileResult.rows.length) {
			return json({ error: "Entity not found" }, { status: 404 });
		}

		const [name, type, connectionsRaw] = profileResult.rows[0];

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

		const profile: EntityProfile = {
			id,
			name: name as string,
			type: type as EntityType,
			connections,
			documents,
			co_occurrences,
		};

		return json(profile);
	} catch (error) {
		console.error("Entity profile error:", error);
		return json({ error: String(error) }, { status: 500 });
	}
};
