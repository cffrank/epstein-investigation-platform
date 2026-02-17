import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { neo4jClient } from '$lib/server/neo4j';

interface CytoscapeElement {
	data: {
		id: string;
		label: string;
		type: string;
		connections?: number;
	};
}

interface CytoscapeEdge {
	data: {
		id: string;
		source: string;
		target: string;
		label: string;
	};
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) {
		return json({ error: 'Platform not available' }, { status: 500 });
	}

	const body = await request.json();
	const { action, ...params } = body;

	const client = neo4jClient(platform);

	try {
		switch (action) {
			case 'search': {
				const { query } = params;
				if (!query || typeof query !== 'string') {
					return json({ error: 'Query required' }, { status: 400 });
				}

				const result = await client.query(
					`
					MATCH (n)
					WHERE (n:Person OR n:Organization OR n:Location)
					  AND toLower(n.name) CONTAINS toLower($query)
					RETURN id(n) as id, labels(n)[0] as type, n.name as name, size((n)--()) as connections
					ORDER BY connections DESC
					LIMIT 20
					`,
					{ query }
				);

				const nodes = result.rows.map((row) => ({
					data: {
						id: String(row[0]),
						type: row[1] as string,
						label: row[2] as string,
						connections: row[3] as number
					}
				}));

				return json({ nodes, edges: [] });
			}

			case 'neighbors': {
				const { nodeId } = params;
				if (!nodeId) {
					return json({ error: 'nodeId required' }, { status: 400 });
				}

				const result = await client.query(
					`
					MATCH (n)-[r]-(m)
					WHERE id(n) = toInteger($nodeId)
					RETURN id(n) as sourceId, id(m) as targetId, labels(m)[0] as targetType,
					       m.name as targetName, type(r) as relType, properties(r) as relProps
					LIMIT 50
					`,
					{ nodeId }
				);

				const nodeMap = new Map<string, CytoscapeElement>();
				const edges: CytoscapeEdge[] = [];

				result.rows.forEach((row) => {
					const sourceId = String(row[0]);
					const targetId = String(row[1]);
					const targetType = row[2] as string;
					const targetName = row[3] as string;
					const relType = row[4] as string;

					// Add target node if not exists
					if (!nodeMap.has(targetId)) {
						nodeMap.set(targetId, {
							data: {
								id: targetId,
								label: targetName,
								type: targetType
							}
						});
					}

					// Add edge
					edges.push({
						data: {
							id: `${sourceId}-${targetId}-${relType}`,
							source: sourceId,
							target: targetId,
							label: relType
						}
					});
				});

				return json({
					nodes: Array.from(nodeMap.values()),
					edges
				});
			}

			case 'path': {
				const { from, to } = params;
				if (!from || !to) {
					return json({ error: 'from and to required' }, { status: 400 });
				}

				const result = await client.query(
					`
					MATCH path = shortestPath((a)-[*..6]-(b))
					WHERE id(a) = toInteger($from) AND id(b) = toInteger($to)
					WITH path
					UNWIND nodes(path) as n
					WITH collect(distinct {id: id(n), name: n.name, type: labels(n)[0]}) as nodes, path
					UNWIND relationships(path) as r
					RETURN nodes,
					       collect(distinct {source: id(startNode(r)), target: id(endNode(r)), type: type(r)}) as edges
					LIMIT 1
					`,
					{ from, to }
				);

				if (result.rows.length === 0) {
					return json({ nodes: [], edges: [], error: 'No path found' });
				}

				const row = result.rows[0];
				const nodes = (row[0] as Array<{ id: number; name: string; type: string }>).map((n) => ({
					data: {
						id: String(n.id),
						label: n.name,
						type: n.type
					}
				}));

				const edges = (row[1] as Array<{ source: number; target: number; type: string }>).map(
					(e) => ({
						data: {
							id: `${e.source}-${e.target}-${e.type}`,
							source: String(e.source),
							target: String(e.target),
							label: e.type
						}
					})
				);

				return json({ nodes, edges });
			}

			default:
				return json({ error: 'Invalid action' }, { status: 400 });
		}
	} catch (error) {
		console.error('Graph API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
