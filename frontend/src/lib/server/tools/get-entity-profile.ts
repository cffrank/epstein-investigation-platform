import { neo4jClient } from "$lib/server/neo4j";
import type Anthropic from "@anthropic-ai/sdk";

export const getEntityProfileTool: Anthropic.Messages.Tool = {
	name: "get_entity_profile",
	description:
		"Get a detailed profile of a person, organization, or location from the knowledge graph, including their connections and document mentions.",
	input_schema: {
		type: "object" as const,
		properties: {
			name: {
				type: "string",
				description: "Name of the entity to look up (case-insensitive partial match).",
			},
			type: {
				type: "string",
				enum: ["Person", "Organization", "Location"],
				description: "Optional entity type filter. If omitted, searches all entity types.",
			},
		},
		required: ["name"],
	},
};

interface ConnectionRow {
	type: string;
	target: string;
	targetLabels: string[];
}

export async function executeGetEntityProfile(
	input: { name: string; type?: string },
	platform: App.Platform,
): Promise<Anthropic.Messages.ToolResultBlockParam["content"]> {
	const neo4j = neo4jClient(platform);

	// Build Cypher query with parameterized values (CR-002 security requirement)
	const typeFilter = input.type ? "AND $type IN labels(e)" : "";

	const result = await neo4j.query(
		`MATCH (e)
		WHERE toLower(e.name) CONTAINS toLower($name) ${typeFilter}
		WITH e LIMIT 1
		OPTIONAL MATCH (e)-[r]-(connected)
		WITH e, type(r) as relType, connected.name as targetName, labels(connected) as targetLabels
		RETURN e.name as name, labels(e) as entityLabels,
			e.aliases as aliases, e.description as description,
			collect(DISTINCT {type: relType, target: targetName, targetLabels: targetLabels})[..50] as connections`,
		{ name: input.name, type: input.type || null },
	);

	if (result.rows.length === 0 || !result.rows[0][0]) {
		return [
			{
				type: "text" as const,
				text: `No entity found matching "${input.name}"${input.type ? ` of type ${input.type}` : ""} in the knowledge graph.`,
			},
		];
	}

	const row = result.rows[0];
	const name = row[0] as string;
	const labels = (row[1] as string[]).filter((l) => l !== "Entity");
	const aliases = row[2] as string[] | null;
	const description = row[3] as string | null;
	const connections = row[4] as ConnectionRow[];

	// Format entity profile as readable text
	let profileText = `# ${name}\n`;
	profileText += `Type: ${labels.join(", ")}\n`;
	if (aliases && aliases.length > 0) {
		profileText += `Aliases: ${aliases.join(", ")}\n`;
	}
	if (description) {
		profileText += `\n${description}\n`;
	}

	if (connections.length > 0) {
		profileText += `\n## Connections (${connections.length})\n`;
		const grouped = new Map<string, string[]>();
		for (const conn of connections) {
			if (!conn.target) continue;
			const key = conn.type || "RELATED_TO";
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key)?.push(conn.target);
		}
		for (const [relType, targets] of grouped) {
			profileText += `\n### ${relType}\n`;
			for (const target of targets.slice(0, 10)) {
				profileText += `- ${target}\n`;
			}
			if (targets.length > 10) {
				profileText += `- ... and ${targets.length - 10} more\n`;
			}
		}
	}

	return [
		{
			type: "search_result" as const,
			source: `/entities/${encodeURIComponent(name)}`,
			title: `${name} (${labels.join(", ")})`,
			content: [
				{
					type: "text" as const,
					text: profileText.slice(0, 1500),
				},
			],
			citations: { enabled: true },
		},
	];
}
