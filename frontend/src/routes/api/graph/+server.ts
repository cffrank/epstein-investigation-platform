import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { neo4jClient } from '$lib/server/neo4j';
import { validateSearchQuery } from '@epstein/shared';

interface CytoscapeElement {
	data: {
		id: string;
		label: string;
		type: string;
		connections?: number;
		pagerank?: number;
		communityId?: number;
		betweenness?: number;
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
				const { query: rawQuery } = params;
				if (!rawQuery || typeof rawQuery !== 'string') {
					return json({ error: 'Query required' }, { status: 400 });
				}
				const query = validateSearchQuery(rawQuery);

				const result = await client.query(
					`
					MATCH (n)
					WHERE (n:Person OR n:Organization OR n:Location)
					  AND toLower(n.name) CONTAINS toLower($query)
					RETURN id(n) as id, labels(n)[0] as type, n.name as name,
					       COUNT { (n)--() } as connections,
					       n.pagerank as pagerank, n.communityId as communityId,
					       n.betweenness as betweenness
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
						connections: row[3] as number,
						...(row[4] != null && { pagerank: row[4] as number }),
						...(row[5] != null && { communityId: row[5] as number }),
						...(row[6] != null && { betweenness: row[6] as number })
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
					       m.name as targetName, type(r) as relType, properties(r) as relProps,
					       m.pagerank as pagerank, m.communityId as communityId,
					       m.betweenness as betweenness
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
								type: targetType,
								...(row[6] != null && { pagerank: row[6] as number }),
								...(row[7] != null && { communityId: row[7] as number }),
								...(row[8] != null && { betweenness: row[8] as number })
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

			case 'pagerank': {
				const limit = params.limit ?? 25;
				const result = await client.query(
					`MATCH (n)
					 WHERE n.pagerank IS NOT NULL
					 RETURN id(n) as id, labels(n)[0] as type, n.name as name,
					        n.pagerank as pagerank, n.communityId as communityId,
					        n.betweenness as betweenness, COUNT { (n)--() } as connections
					 ORDER BY n.pagerank DESC
					 LIMIT $limit`,
					{ limit }
				);

				const results = result.rows.map((row) => ({
					id: String(row[0]),
					type: row[1] as string,
					name: row[2] as string,
					pagerank: row[3] as number,
					communityId: row[4] as number | null,
					betweenness: row[5] as number | null,
					connections: row[6] as number
				}));

				return json({ results });
			}

			case 'communities': {
				const limit = params.limit ?? 25;
				const result = await client.query(
					`MATCH (n)
					 WHERE n.communityId IS NOT NULL
					 RETURN id(n) as id, labels(n)[0] as type, n.name as name,
					        n.communityId as communityId, n.pagerank as pagerank,
					        n.betweenness as betweenness, COUNT { (n)--() } as connections
					 ORDER BY n.pagerank DESC
					 LIMIT $limit`,
					{ limit }
				);

				const results = result.rows.map((row) => ({
					id: String(row[0]),
					type: row[1] as string,
					name: row[2] as string,
					communityId: row[3] as number,
					pagerank: row[4] as number | null,
					betweenness: row[5] as number | null,
					connections: row[6] as number
				}));

				const sizeResult = await client.query(
					`MATCH (n)
					 WHERE n.communityId IS NOT NULL
					 RETURN n.communityId as communityId, count(*) as size
					 ORDER BY size DESC
					 LIMIT 8`
				);

				const communitySizes = sizeResult.rows.map((row) => ({
					communityId: row[0] as number,
					size: row[1] as number
				}));

				return json({ results, communitySizes });
			}

			case 'bridges': {
				const limit = params.limit ?? 25;
				const result = await client.query(
					`MATCH (n)
					 WHERE n.betweenness IS NOT NULL
					 RETURN id(n) as id, labels(n)[0] as type, n.name as name,
					        n.betweenness as betweenness, n.pagerank as pagerank,
					        n.communityId as communityId, COUNT { (n)--() } as connections
					 ORDER BY n.betweenness DESC
					 LIMIT $limit`,
					{ limit }
				);

				const results = result.rows.map((row) => ({
					id: String(row[0]),
					type: row[1] as string,
					name: row[2] as string,
					betweenness: row[3] as number,
					pagerank: row[4] as number | null,
					communityId: row[5] as number | null,
					connections: row[6] as number
				}));

				return json({ results });
			}

			case 'hidden-connections': {
				const result = await client.query(
					`MATCH (a:Person)-[]->(shared)<-[]-(b:Person)
					 WHERE NOT (a)-[]-(b) AND id(a) < id(b)
					 WITH a, b, collect(DISTINCT shared) as sharedNodes, count(DISTINCT shared) as cnt
					 WHERE cnt >= 3
					 RETURN id(a) as personAId, a.name as personAName,
					        id(b) as personBId, b.name as personBName,
					        cnt as sharedCount,
					        [s IN sharedNodes[0..10] | {id: id(s), name: s.name, type: labels(s)[0]}] as topSharedNeighbors
					 ORDER BY cnt DESC
					 LIMIT 20`
				);

				const pairs = result.rows.map((row) => ({
					personAId: String(row[0]),
					personAName: row[1] as string,
					personBId: String(row[2]),
					personBName: row[3] as string,
					sharedCount: row[4] as number,
					topSharedNeighbors: row[5] as Array<{ id: number; name: string; type: string }>
				}));

				return json({ pairs });
			}

			case 'algorithm-status': {
				const metaResult = await client.query(
					`OPTIONAL MATCH (m:Metadata {key: 'algorithm_last_computed'})
					 RETURN m.value as lastComputed`
				);

				const countResult = await client.query(
					`MATCH (n) WHERE n.pagerank IS NOT NULL RETURN count(n) as count`
				);

				return json({
					lastComputed: (metaResult.rows[0]?.[0] as string) ?? null,
					nodeCount: (countResult.rows[0]?.[0] as number) ?? 0
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
