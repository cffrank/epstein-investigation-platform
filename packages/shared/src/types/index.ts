// SQL query result type
export interface SqlQuery {
	text: string;
	values: unknown[];
}

// Cypher query result type
export interface CypherQuery {
	query: string;
	params: Record<string, unknown>;
}

// Auth types
export interface AuthUser {
	email: string;
}

// Document types
export interface Document {
	id: string;
	filename: string;
	source: string;
	doc_type: string | null;
	file_size_bytes: number | null;
	r2_key: string | null;
	text: string | null;
	page_count: number | null;
	content_hash: string | null;
	created_at: string;
}

export interface SearchResult {
	id: string;
	filename: string;
	source: string;
	doc_type: string | null;
	snippet: string;
	score: number;
	date: string | null;
	entities: EntityRef[];
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	query: string;
	mode: SearchMode;
}

export type SearchMode = "fulltext" | "semantic" | "hybrid";

// Entity types
export interface Entity {
	id: string;
	name: string;
	type: EntityType;
	document_count: number;
	properties: Record<string, unknown>;
	connections?: number;
}

export type EntityType = "Person" | "Organization" | "Location";

export interface EntityRef {
	id: string;
	name: string;
	type: EntityType;
}

export interface EntityConnection {
	id: string;
	name: string;
	type: EntityType;
	relationship_type: string;
}

export interface EntityCoOccurrence {
	id: string;
	name: string;
	type: EntityType;
	shared_docs: number;
}

export interface EntityProfile {
	id: string;
	name: string;
	type: EntityType;
	connections: EntityConnection[];
	documents: Document[];
	co_occurrences: EntityCoOccurrence[];
}

// Graph types
export interface GraphNode {
	id: string;
	label: string;
	type: EntityType | "Document";
	properties: Record<string, unknown>;
}

export interface GraphEdge {
	source: string;
	target: string;
	type: string;
	properties: Record<string, unknown>;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

// Chat types
export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	citations?: Citation[];
}

export interface Citation {
	index: number;
	document_id: string;
	filename: string;
	source: string;
	excerpt: string;
	score: number;
}
