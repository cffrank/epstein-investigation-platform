#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const { Pool } = pg;

// Database configuration from environment
const pool = new Pool({
	host: process.env.PG_HOST || "88.99.61.233",
	port: Number.parseInt(process.env.PG_PORT || "5432"),
	database: process.env.PG_DATABASE || "platform",
	user: process.env.PG_USER || "investigation",
	password: process.env.PG_PASSWORD,
	ssl: false,
});

// Create MCP server
const server = new Server(
	{
		name: "epstein-documents",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "search_documents",
				description:
					"Search documents using full-text search. Returns matching documents with filename, summary, and relevance score.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Search query (supports AND, OR, phrases in quotes)",
						},
						dataset: {
							type: "string",
							description: "Filter by dataset (e.g., dataset_9, dataset_10)",
						},
						limit: {
							type: "number",
							description: "Maximum results to return (default 20, max 100)",
							default: 20,
						},
					},
					required: ["query"],
				},
			},
			{
				name: "get_document",
				description: "Get full details of a specific document by filename",
				inputSchema: {
					type: "object",
					properties: {
						filename: {
							type: "string",
							description: "Document filename (e.g., EFTA00095502.pdf)",
						},
					},
					required: ["filename"],
				},
			},
			{
				name: "count_person_mentions",
				description: "Count how many documents mention a specific person",
				inputSchema: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Person name to search for",
						},
					},
					required: ["name"],
				},
			},
			{
				name: "get_person_documents",
				description: "Get documents mentioning a specific person with context",
				inputSchema: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Person name to search for",
						},
						limit: {
							type: "number",
							description: "Maximum results (default 10)",
							default: 10,
						},
					},
					required: ["name"],
				},
			},
			{
				name: "get_database_stats",
				description: "Get statistics about the document database",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "search_by_date_range",
				description: "Search documents within a date range mentioned in the text",
				inputSchema: {
					type: "object",
					properties: {
						start_year: {
							type: "number",
							description: "Start year",
						},
						end_year: {
							type: "number",
							description: "End year",
						},
						additional_query: {
							type: "string",
							description: "Additional search terms",
						},
						limit: {
							type: "number",
							default: 20,
						},
					},
					required: ["start_year", "end_year"],
				},
			},
		],
	};
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		switch (name) {
			case "search_documents": {
				const { query, dataset, limit = 20 } = args;
				const safeLimit = Math.min(limit, 100);

				let sql = `
          SELECT
            filename,
            source,
            metadata->>'summary' as summary,
            ts_rank(search_vector, plainto_tsquery('english', $1)) as relevance
          FROM documents
          WHERE search_vector @@ plainto_tsquery('english', $1)
        `;
				const params = [query];

				if (dataset) {
					sql += " AND source = $2";
					params.push(dataset);
				}

				sql += ` ORDER BY relevance DESC LIMIT $${params.length + 1}`;
				params.push(safeLimit);

				const result = await pool.query(sql, params);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query,
									count: result.rows.length,
									documents: result.rows,
								},
								null,
								2,
							),
						},
					],
				};
			}

			case "get_document": {
				const { filename } = args;

				const result = await pool.query(
					`SELECT
            filename, source, doc_type, page_count, file_size_bytes,
            metadata->>'summary' as summary,
            metadata->>'extracted_text' as extracted_text,
            r2_key,
            created_at
          FROM documents
          WHERE filename = $1`,
					[filename],
				);

				if (result.rows.length === 0) {
					return {
						content: [{ type: "text", text: `Document not found: ${filename}` }],
					};
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result.rows[0], null, 2),
						},
					],
				};
			}

			case "count_person_mentions": {
				const { name: personName } = args;

				const result = await pool.query(
					`SELECT COUNT(*) as count
           FROM documents
           WHERE metadata->>'extracted_text' ILIKE $1`,
					[`%${personName}%`],
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								person: personName,
								document_count: Number.parseInt(result.rows[0].count),
							}),
						},
					],
				};
			}

			case "get_person_documents": {
				const { name: personName, limit = 10 } = args;
				const safeLimit = Math.min(limit, 50);

				const result = await pool.query(
					`SELECT
            filename,
            source,
            metadata->>'summary' as summary,
            substring(metadata->>'extracted_text' from 1 for 500) as text_preview
          FROM documents
          WHERE metadata->>'extracted_text' ILIKE $1
          LIMIT $2`,
					[`%${personName}%`, safeLimit],
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									person: personName,
									count: result.rows.length,
									documents: result.rows,
								},
								null,
								2,
							),
						},
					],
				};
			}

			case "get_database_stats": {
				const stats = await pool.query(`
          SELECT
            COUNT(*) as total_documents,
            COUNT(DISTINCT source) as datasets,
            SUM(file_size_bytes) as total_bytes,
            SUM(page_count) as total_pages
          FROM documents
        `);

				const byDataset = await pool.query(`
          SELECT source, COUNT(*) as count
          FROM documents
          GROUP BY source
          ORDER BY count DESC
        `);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									overview: stats.rows[0],
									by_dataset: byDataset.rows,
								},
								null,
								2,
							),
						},
					],
				};
			}

			case "search_by_date_range": {
				const { start_year, end_year, additional_query, limit = 20 } = args;
				const safeLimit = Math.min(limit, 100);

				// Build regex pattern for years in range
				const years = [];
				for (let y = start_year; y <= end_year; y++) {
					years.push(y.toString());
				}
				const yearPattern = years.join("|");

				let sql = `
          SELECT
            filename,
            source,
            metadata->>'summary' as summary
          FROM documents
          WHERE metadata->>'extracted_text' ~ $1
        `;
				const params = [yearPattern];

				if (additional_query) {
					sql += ` AND search_vector @@ plainto_tsquery('english', $2)`;
					params.push(additional_query);
				}

				sql += ` LIMIT $${params.length + 1}`;
				params.push(safeLimit);

				const result = await pool.query(sql, params);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									date_range: `${start_year}-${end_year}`,
									additional_query,
									count: result.rows.length,
									documents: result.rows,
								},
								null,
								2,
							),
						},
					],
				};
			}

			default:
				return {
					content: [{ type: "text", text: `Unknown tool: ${name}` }],
					isError: true,
				};
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error: ${error.message}`,
				},
			],
			isError: true,
		};
	}
});

// Start server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Epstein Documents MCP server running");
}

main().catch(console.error);
