import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { neo4jClient } from '$lib/server/neo4j';
import type { Entity, EntityType } from '$lib/types';

interface EntityListRequest {
	action: 'list' | 'search';
	query?: string;
	type?: EntityType;
	offset?: number;
	limit?: number;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform?.env) {
		return json({ error: 'Platform unavailable in dev mode' }, { status: 500 });
	}

	try {
		const body = (await request.json()) as EntityListRequest;
		const { action, query, type, offset = 0, limit = 50 } = body;

		const neo4j = neo4jClient(platform);
		let cypher: string;
		let params: Record<string, unknown>;

		if (action === 'search' && query) {
			// Search entities by name
			cypher = `
				MATCH (n)
				WHERE (n:Person OR n:Organization OR n:Location)
				  AND toLower(n.name) CONTAINS toLower($query)
				WITH n, labels(n)[0] as type, COUNT { (n)--() } as connections
				RETURN id(n) as id, n.name as name, type, connections
				ORDER BY connections DESC
				SKIP $offset
				LIMIT $limit
			`;
			params = { query, offset, limit };
		} else if (action === 'list' && type) {
			// List entities of a specific type
			// Validate type to prevent injection
			if (!['Person', 'Organization', 'Location'].includes(type)) {
				return json({ error: 'Invalid entity type' }, { status: 400 });
			}

			cypher = `
				MATCH (n:${type})
				WITH n, COUNT { (n)--() } as connections
				RETURN id(n) as id, n.name as name, '${type}' as type, connections
				ORDER BY connections DESC
				SKIP $offset
				LIMIT $limit
			`;
			params = { offset, limit };
		} else {
			// List all entities
			cypher = `
				MATCH (n)
				WHERE n:Person OR n:Organization OR n:Location
				WITH n, labels(n)[0] as type, COUNT { (n)--() } as connections
				RETURN id(n) as id, n.name as name, type, connections
				ORDER BY connections DESC
				SKIP $offset
				LIMIT $limit
			`;
			params = { offset, limit };
		}

		const result = await neo4j.query(cypher, params);

		const entities: Entity[] = result.rows.map((row) => ({
			id: String(row[0]),
			name: row[1] as string,
			type: row[2] as EntityType,
			connections: row[3] as number,
			document_count: 0,
			properties: {}
		}));

		return json({ entities });
	} catch (error) {
		console.error('Entity list error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
