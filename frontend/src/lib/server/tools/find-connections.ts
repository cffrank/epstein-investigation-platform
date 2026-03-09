import { neo4jClient } from "$lib/server/neo4j";
import type Anthropic from "@anthropic-ai/sdk";

export const findConnectionsTool: Anthropic.Messages.Tool = {
	name: "find_connections",
	description:
		"Discover connections between two entities in the knowledge graph. Finds shortest paths and shared associations. Useful for investigating relationships between people, organizations, or locations.",
	input_schema: {
		type: "object" as const,
		properties: {
			entity_a: {
				type: "string",
				description: "Name of the first entity (case-insensitive partial match).",
			},
			entity_b: {
				type: "string",
				description: "Name of the second entity (case-insensitive partial match).",
			},
			max_path_length: {
				type: "number",
				description: "Maximum path length to search. Default 4, range 2-6.",
			},
		},
		required: ["entity_a", "entity_b"],
	},
};

export async function executeFindConnections(
	input: { entity_a: string; entity_b: string; max_path_length?: number },
	platform: App.Platform,
): Promise<Anthropic.Messages.ToolResultBlockParam["content"]> {
	const neo4j = neo4jClient(platform);
	const maxLen = Math.min(Math.max(input.max_path_length ?? 4, 2), 6);

	// Parameterized Cypher query (CR-002 security requirement)
	const result = await neo4j.query(
		`MATCH (a), (b)
		WHERE toLower(a.name) CONTAINS toLower($entityA)
			AND toLower(b.name) CONTAINS toLower($entityB)
		WITH a, b LIMIT 1
		MATCH path = shortestPath((a)-[*..${maxLen}]-(b))
		WITH path, nodes(path) as pathNodes, relationships(path) as pathRels
		RETURN
			[n IN pathNodes | n.name] as nodeNames,
			[n IN pathNodes | labels(n)] as nodeLabels,
			[r IN pathRels | type(r)] as relTypes,
			length(path) as pathLength`,
		{ entityA: input.entity_a, entityB: input.entity_b },
	);

	if (result.rows.length === 0) {
		return [
			{
				type: "text" as const,
				text: `No connection found between "${input.entity_a}" and "${input.entity_b}" within ${maxLen} hops. They may not be connected in the knowledge graph, or the path may be longer than ${maxLen} steps.`,
			},
		];
	}

	const row = result.rows[0];
	const nodeNames = row[0] as string[];
	const nodeLabels = row[1] as string[][];
	const relTypes = row[2] as string[];
	const pathLength = row[3] as number;

	// Build readable path description
	let pathDescription = `## Connection Path (${pathLength} steps)\n\n`;
	for (let i = 0; i < nodeNames.length; i++) {
		const labels = (nodeLabels[i] || []).filter((l) => l !== "Entity");
		pathDescription += `${nodeNames[i]} [${labels.join(", ")}]`;
		if (i < relTypes.length) {
			pathDescription += ` --[${relTypes[i]}]--> `;
		}
	}

	pathDescription += "\n\n### Path Summary\n";
	pathDescription += `From: ${nodeNames[0]}\n`;
	pathDescription += `To: ${nodeNames[nodeNames.length - 1]}\n`;
	pathDescription += `Steps: ${pathLength}\n`;
	pathDescription += `Via: ${nodeNames.slice(1, -1).join(" -> ") || "direct connection"}`;

	return [
		{
			type: "search_result" as const,
			source: `/entities/${encodeURIComponent(nodeNames[0])}`,
			title: `Connection: ${nodeNames[0]} ↔ ${nodeNames[nodeNames.length - 1]}`,
			content: [
				{
					type: "text" as const,
					text: pathDescription.slice(0, 1500),
				},
			],
			citations: { enabled: true },
		},
	];
}
