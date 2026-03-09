import type { CypherQuery } from "../types/index.js";

/**
 * Allowed Neo4j relationship types. These should be refreshed from
 * `CALL db.relationshipTypes()` on the live database periodically.
 */
export const ALLOWED_RELATIONSHIP_TYPES = new Set<string>([
	"MENTIONED_IN",
	"CONNECTED_TO",
	"ASSOCIATED_WITH",
	"WORKS_FOR",
	"LOCATED_IN",
	"RELATED_TO",
	"APPEARED_WITH",
	"EMPLOYED_BY",
	"OWNS",
	"MEMBER_OF",
]);

/**
 * Allowed Neo4j node labels.
 */
export const ALLOWED_NODE_LABELS = new Set<string>([
	"Person",
	"Organization",
	"Location",
	"Document",
	"Event",
]);

/**
 * Filter relationship types against the allowlist.
 * Returns only types that exist in ALLOWED_RELATIONSHIP_TYPES.
 */
export function validateRelationshipTypes(types: string[]): string[] {
	return types.filter((t) => ALLOWED_RELATIONSHIP_TYPES.has(t));
}

/**
 * Filter node labels against the allowlist.
 * Returns only labels that exist in ALLOWED_NODE_LABELS.
 */
export function validateNodeLabels(labels: string[]): string[] {
	return labels.filter((l) => ALLOWED_NODE_LABELS.has(l));
}

/**
 * Build a parameterized graph traversal Cypher query.
 * Clamps depth to 1-4. Validates relationship types against allowlist.
 * No user input is ever string-interpolated into the Cypher query.
 */
export function buildTraversalQuery(relationshipTypes: string[], maxDepth: number): CypherQuery {
	const clampedDepth = Math.max(1, Math.min(4, Math.floor(maxDepth)));
	const validTypes = validateRelationshipTypes(relationshipTypes);

	// Build relationship type filter using allowlisted types only (safe since they come from our Set)
	// These are NOT user input - they've been validated against the allowlist
	const relTypeFilter = validTypes.length > 0 ? `[:${validTypes.join("|")}]` : ""; // empty means any relationship type

	const query = `MATCH path = (start)-${relTypeFilter}*1..${clampedDepth}-(end)
WHERE start.name = $startNode
RETURN path
LIMIT $limit`;

	return {
		query,
		params: {
			startNode: "",
			maxDepth: clampedDepth,
			limit: 100,
		},
	};
}

/**
 * Build a parameterized neighbor lookup query.
 */
export function buildNeighborsQuery(): CypherQuery {
	return {
		query: `MATCH (n)-[r]-(neighbor)
WHERE n.name = $name
RETURN neighbor.name AS name, labels(neighbor) AS labels, type(r) AS relationship
ORDER BY neighbor.name
LIMIT $limit`,
		params: {
			name: "",
			limit: 50,
		},
	};
}

/**
 * Build a parameterized shortest path query.
 */
export function buildShortestPathQuery(): CypherQuery {
	return {
		query: `MATCH (a), (b)
WHERE a.name = $startName AND b.name = $endName
MATCH path = shortestPath((a)-[*..6]-(b))
RETURN path`,
		params: {
			startName: "",
			endName: "",
		},
	};
}
