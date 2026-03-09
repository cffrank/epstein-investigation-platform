import { neo4jClient } from "$lib/server/neo4j";
import type { Entity, EntityType } from "$lib/types";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform?.env) {
		return {
			entities: [],
		};
	}

	try {
		const neo4j = neo4jClient(platform);

		// Fetch top entities by connection count
		const cypher = `
			MATCH (n)
			WHERE n:Person OR n:Organization OR n:Location
			WITH n, labels(n)[0] as type, COUNT { (n)--() } as connections
			RETURN id(n) as id, n.name as name, type, connections
			ORDER BY connections DESC
			LIMIT 50
		`;

		const result = await neo4j.query(cypher, {});

		const entities: Entity[] = result.rows.map((row) => ({
			id: String(row[0]),
			name: row[1] as string,
			type: row[2] as EntityType,
			connections: row[3] as number,
			document_count: 0,
			properties: {},
		}));

		return {
			entities,
		};
	} catch (error) {
		console.error("Entity load error:", error);
		return {
			entities: [],
		};
	}
};
