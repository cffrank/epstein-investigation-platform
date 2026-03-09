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

export interface SearchFilters {
	dateRange?: [string, string];
	sources?: string[];
	docTypes?: string[];
	classifications?: string[];
	entityIds?: string[];
}

export interface SavedSearch {
	id: string;
	name: string;
	query: string;
	mode: SearchMode;
	filters: SearchFilters;
	createdAt: string;
}

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

// Tool call tracking for UI
export interface ToolCall {
	id: string;
	name: string;
	input?: Record<string, unknown>;
	status: "running" | "complete" | "error";
	resultCount?: number;
	error?: string;
}

// Native citation from Anthropic API
export interface NativeCitation {
	type: "char_location" | "page_location" | "content_block_location";
	cited_text: string;
	document_index: number;
	document_title: string;
	source: string;
	start_char_index?: number;
	end_char_index?: number;
}

// Model selection keys
export type ModelKey = "haiku-4.5" | "sonnet-4.6" | "opus-4.6";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	citations?: NativeCitation[];
	toolCalls?: ToolCall[];
}

// Legacy citation type for backward compatibility
export interface Citation {
	index: number;
	document_id: string;
	filename: string;
	source: string;
	excerpt: string;
	score: number;
}

// Investigation notes for analyst observations on entities
export interface InvestigationNote {
	id: string;
	entity_id: string;
	content: string;
	created_at: string;
	updated_at: string;
}

// AI-generated entity biography
export interface EntityBiography {
	content: string;
	generated_at: string;
	model: string;
	citations?: NativeCitation[];
}

// Timeline event for entity chronology
export interface TimelineEvent {
	id: string;
	date: string;
	description: string;
	document_id: string | null;
	document_name: string | null;
	event_type: string;
}

// Extended entity profile for dossier page
export interface EntityDossier extends EntityProfile {
	aliases: string[];
	document_count: number;
	connection_count: number;
	biography: EntityBiography | null;
	notes: InvestigationNote[];
	timeline_events: TimelineEvent[];
}
