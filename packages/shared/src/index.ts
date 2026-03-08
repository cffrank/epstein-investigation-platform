// Types
export type {
	SqlQuery,
	CypherQuery,
	AuthUser,
	Document,
	SearchResult,
	SearchResponse,
	SearchMode,
	Entity,
	EntityType,
	EntityRef,
	EntityConnection,
	EntityCoOccurrence,
	EntityProfile,
	GraphNode,
	GraphEdge,
	GraphData,
	ChatMessage,
	Citation,
} from "./types/index.js";

// SQL query builders
export {
	buildFulltextSearchQuery,
	buildCappedCountQuery,
	buildDocumentStatsQuery,
	buildEntityListQuery,
} from "./query-builders/sql.js";

// Cypher query builders
export {
	ALLOWED_RELATIONSHIP_TYPES,
	ALLOWED_NODE_LABELS,
	validateRelationshipTypes,
	validateNodeLabels,
	buildTraversalQuery,
	buildNeighborsQuery,
	buildShortestPathQuery,
} from "./query-builders/cypher.js";

// Auth guards
export { createRequireApiKey, createRequireAuth } from "./auth/guards.js";

// Validation and sanitization
export {
	SEARCH_SNIPPET_SANITIZE_CONFIG,
	CHAT_CONTENT_SANITIZE_CONFIG,
	DOCUMENT_TEXT_SANITIZE_CONFIG,
	validateSearchQuery,
	validatePaginationParams,
} from "./validation/sanitize.js";
