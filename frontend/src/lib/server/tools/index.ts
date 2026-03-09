import type Anthropic from "@anthropic-ai/sdk";
import { executeFindConnections, findConnectionsTool } from "./find-connections";
import { executeGetEntityProfile, getEntityProfileTool } from "./get-entity-profile";
import { executeGraphQuery, graphQueryTool } from "./graph-query";
import { executeSearchDocuments, searchDocumentsTool } from "./search-documents";
import { executeSemanticSearch, semanticSearchTool } from "./semantic-search";

/**
 * All tool definitions for the Claude API.
 * These are passed to `messages.stream({ tools: toolDefinitions })`.
 */
export const toolDefinitions: Anthropic.Messages.Tool[] = [
	searchDocumentsTool,
	semanticSearchTool,
	getEntityProfileTool,
	graphQueryTool,
	findConnectionsTool,
];

/**
 * Execute a tool by name with the given input.
 * Returns search_result blocks for native Anthropic citations.
 * Handles errors gracefully — returns error text instead of throwing.
 */
export async function executeTool(
	name: string,
	input: unknown,
	platform: App.Platform,
): Promise<Anthropic.Messages.ToolResultBlockParam["content"]> {
	try {
		switch (name) {
			case "search_documents":
				return await executeSearchDocuments(input as { query: string; limit?: number }, platform);

			case "semantic_search":
				return await executeSemanticSearch(input as { query: string; limit?: number }, platform);

			case "get_entity_profile":
				return await executeGetEntityProfile(input as { name: string; type?: string }, platform);

			case "graph_query":
				return await executeGraphQuery(
					input as {
						entity_name: string;
						relationship_type?: string;
						max_depth?: number;
						limit?: number;
					},
					platform,
				);

			case "find_connections":
				return await executeFindConnections(
					input as {
						entity_a: string;
						entity_b: string;
						max_path_length?: number;
					},
					platform,
				);

			default:
				return [
					{
						type: "text" as const,
						text: `Unknown tool: ${name}. Available tools: search_documents, semantic_search, get_entity_profile, graph_query, find_connections.`,
					},
				];
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		console.error(`Tool execution error (${name}):`, error);
		return [
			{
				type: "text" as const,
				text: `Error executing ${name}: ${message}`,
			},
		];
	}
}
