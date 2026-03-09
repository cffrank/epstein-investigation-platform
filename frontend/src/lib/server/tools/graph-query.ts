import type Anthropic from '@anthropic-ai/sdk';
import { neo4jClient } from '$lib/server/neo4j';

export const graphQueryTool: Anthropic.Messages.Tool = {
	name: 'graph_query',
	description:
		'Traverse relationships in the knowledge graph. Find entities connected to a given entity by specified relationship types. Useful for exploring networks around a person or organization.',
	input_schema: {
		type: 'object' as const,
		properties: {
			entity_name: {
				type: 'string',
				description: 'Name of the entity to start traversal from (case-insensitive partial match).',
			},
			relationship_type: {
				type: 'string',
				description:
					'Optional relationship type to filter (e.g., "ASSOCIATED_WITH", "MENTIONED_IN"). If omitted, returns all relationship types.',
			},
			max_depth: {
				type: 'number',
				description: 'Maximum traversal depth. Default 1, max 3.',
			},
			limit: {
				type: 'number',
				description: 'Maximum number of connected entities to return. Default 20, max 50.',
			},
		},
		required: ['entity_name'],
	},
};

export async function executeGraphQuery(
	input: {
		entity_name: string;
		relationship_type?: string;
		max_depth?: number;
		limit?: number;
	},
	platform: App.Platform
): Promise<Anthropic.Messages.ToolResultBlockParam['content']> {
	const neo4j = neo4jClient(platform);
	const depth = Math.min(Math.max(input.max_depth ?? 1, 1), 3);
	const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

	// Build parameterized Cypher query (CR-002 security requirement)
	// Relationship type filter uses CASE expression with parameter, not string interpolation
	const relFilter = input.relationship_type
		? `AND type(r) = $relType`
		: '';

	const cypher = `MATCH (start)
		WHERE toLower(start.name) CONTAINS toLower($name)
		WITH start LIMIT 1
		MATCH (start)-[r*1..${depth}]-(connected)
		WHERE ALL(rel IN r WHERE true ${relFilter ? `AND type(rel) = $relType` : ''})
		WITH DISTINCT connected, r,
			[rel IN r | type(rel)] as relTypes,
			[rel IN r | startNode(rel).name + ' -[' + type(rel) + ']-> ' + endNode(rel).name] as pathDesc
		RETURN connected.name as name, labels(connected) as entityLabels,
			relTypes, pathDesc[0] as relationship
		LIMIT $limit`;

	const result = await neo4j.query(cypher, {
		name: input.entity_name,
		relType: input.relationship_type || null,
		limit,
	});

	if (result.rows.length === 0) {
		return [
			{
				type: 'text' as const,
				text: `No connections found for "${input.entity_name}"${input.relationship_type ? ` via ${input.relationship_type}` : ''} within ${depth} hops.`,
			},
		];
	}

	return result.rows.map((row) => {
		const name = row[0] as string;
		const labels = (row[1] as string[]).filter((l) => l !== 'Entity');
		const relTypes = row[2] as string[];
		const relationship = row[3] as string;

		return {
			type: 'search_result' as const,
			source: `/entities/${encodeURIComponent(name)}`,
			title: `${name} (${labels.join(', ')})`,
			content: [
				{
					type: 'text' as const,
					text: `Connection: ${relationship}\nRelationship types: ${[...new Set(relTypes)].join(', ')}`,
				},
			],
			citations: { enabled: true },
		};
	});
}
