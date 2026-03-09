#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
	host: process.env.PG_HOST || "88.99.61.233",
	port: Number.parseInt(process.env.PG_PORT || "5432"),
	database: process.env.PG_DATABASE || "platform",
	user: process.env.PG_USER || "investigation",
	password: process.env.PG_PASSWORD,
	ssl: false,
});

const server = new Server(
	{
		name: "epstein-intelligence",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "get_subject_intelligence",
				description: "Get all intelligence gathered on a specific person/subject",
				inputSchema: {
					type: "object",
					properties: {
						subject: {
							type: "string",
							description: "Name of the person to look up",
						},
					},
					required: ["subject"],
				},
			},
			{
				name: "list_all_subjects",
				description: "List all subjects in the intelligence database with their status",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "add_investigation_note",
				description: "Add a new investigation note about a subject",
				inputSchema: {
					type: "object",
					properties: {
						subject: { type: "string", description: "Person or entity name" },
						allegation_type: {
							type: "string",
							enum: [
								"rape",
								"sexual_abuse",
								"trafficking",
								"associate",
								"event_attendee",
								"cleared",
								"not_accused_by_giuffre",
								"childhood_abuse",
							],
							description: "Type of allegation or status",
						},
						source_url: { type: "string", description: "URL of the source" },
						summary: { type: "string", description: "Summary of the intelligence" },
						corroborating_docs: {
							type: "array",
							items: { type: "string" },
							description: "Array of EFTA document IDs that corroborate this",
						},
						source_credibility_tier: {
							type: "number",
							description: "Source credibility tier (1-5, 1=highest)",
						},
					},
					required: ["subject", "allegation_type", "summary"],
				},
			},
			{
				name: "update_verification_status",
				description: "Update the verification status of an existing note",
				inputSchema: {
					type: "object",
					properties: {
						subject: { type: "string", description: "Subject name" },
						primary_doc_verified: {
							type: "boolean",
							description: "Whether verified by primary documents",
						},
						corroboration_count: { type: "number", description: "Number of corroborating sources" },
						verification_notes: { type: "string", description: "Notes about verification" },
					},
					required: ["subject"],
				},
			},
			{
				name: "check_source_credibility",
				description: "Check the credibility rating of a news source",
				inputSchema: {
					type: "object",
					properties: {
						domain: {
							type: "string",
							description: "Domain name (e.g., cnn.com, dailymail.co.uk)",
						},
					},
					required: ["domain"],
				},
			},
			{
				name: "list_source_credibility",
				description: "List all source credibility ratings by tier",
				inputSchema: {
					type: "object",
					properties: {
						tier: {
							type: "number",
							description: "Filter by specific tier (1-5), or omit for all",
						},
					},
				},
			},
			{
				name: "add_source_rating",
				description: "Add or update a source credibility rating",
				inputSchema: {
					type: "object",
					properties: {
						domain: { type: "string", description: "Source domain" },
						source_name: { type: "string", description: "Human readable name" },
						source_type: {
							type: "string",
							enum: [
								"primary_document",
								"wire_service",
								"major_news",
								"tabloid",
								"blog",
								"social_media",
								"wiki",
								"state_media",
							],
						},
						credibility_tier: { type: "number", description: "Tier 1-5 (1=highest)" },
						known_bias: {
							type: "string",
							enum: [
								"neutral",
								"left",
								"left_lean",
								"right",
								"right_lean",
								"sensationalist",
								"anti_western",
								"unknown",
							],
						},
						notes: { type: "string", description: "Notes about this source" },
					},
					required: ["domain", "credibility_tier"],
				},
			},
			{
				name: "get_verification_scores",
				description: "Get verification scores for all subjects",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "list_accused_perpetrators",
				description: "List all subjects accused of crimes",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "list_cleared_individuals",
				description: "List individuals cleared or not accused",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
		],
	};
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		switch (name) {
			case "get_subject_intelligence": {
				const { subject } = args;

				const notes = await pool.query("SELECT * FROM investigation_notes WHERE subject ILIKE $1", [
					`%${subject}%`,
				]);

				const tags = await pool.query(
					`SELECT at.*, d.filename
           FROM allegation_tags at
           LEFT JOIN documents d ON at.document_id = d.id
           WHERE at.accused_name ILIKE $1`,
					[`%${subject}%`],
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									subject,
									investigation_notes: notes.rows,
									tagged_documents: tags.rows,
								},
								null,
								2,
							),
						},
					],
				};
			}

			case "list_all_subjects": {
				const result = await pool.query(`
          SELECT subject, allegation_type, confidence_level,
                 source_credibility_tier, corroboration_count, primary_doc_verified
          FROM investigation_notes
          ORDER BY subject
        `);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ subjects: result.rows }, null, 2),
						},
					],
				};
			}

			case "add_investigation_note": {
				const {
					subject,
					allegation_type,
					source_url,
					summary,
					corroborating_docs = [],
					source_credibility_tier,
				} = args;

				const result = await pool.query(
					`INSERT INTO investigation_notes
           (subject, allegation_type, source_type, source_url, summary, corroborating_docs, source_credibility_tier)
           VALUES ($1, $2, 'news_coverage', $3, $4, $5, $6)
           RETURNING id`,
					[
						subject,
						allegation_type,
						source_url,
						summary,
						corroborating_docs,
						source_credibility_tier,
					],
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ success: true, note_id: result.rows[0].id }),
						},
					],
				};
			}

			case "update_verification_status": {
				const { subject, primary_doc_verified, corroboration_count, verification_notes } = args;

				const updates = [];
				const values = [];
				let paramCount = 1;

				if (primary_doc_verified !== undefined) {
					updates.push(`primary_doc_verified = $${paramCount++}`);
					values.push(primary_doc_verified);
				}
				if (corroboration_count !== undefined) {
					updates.push(`corroboration_count = $${paramCount++}`);
					values.push(corroboration_count);
				}
				if (verification_notes) {
					updates.push(`verification_notes = $${paramCount++}`);
					values.push(verification_notes);
				}
				updates.push("updated_at = NOW()");

				values.push(subject);

				await pool.query(
					`UPDATE investigation_notes SET ${updates.join(", ")} WHERE subject = $${paramCount}`,
					values,
				);

				return {
					content: [{ type: "text", text: JSON.stringify({ success: true, subject }) }],
				};
			}

			case "check_source_credibility": {
				const { domain } = args;

				const result = await pool.query(
					"SELECT * FROM source_credibility WHERE source_domain ILIKE $1",
					[`%${domain}%`],
				);

				if (result.rows.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									domain,
									status: "NOT_RATED",
									recommendation:
										"This source has not been rated. Treat with caution and verify claims independently.",
								}),
							},
						],
					};
				}

				return {
					content: [{ type: "text", text: JSON.stringify(result.rows[0], null, 2) }],
				};
			}

			case "list_source_credibility": {
				const { tier } = args;

				let sql = "SELECT * FROM source_credibility";
				const params = [];

				if (tier) {
					sql += " WHERE credibility_tier = $1";
					params.push(tier);
				}

				sql += " ORDER BY credibility_tier, source_name";

				const result = await pool.query(sql, params);

				return {
					content: [{ type: "text", text: JSON.stringify({ sources: result.rows }, null, 2) }],
				};
			}

			case "add_source_rating": {
				const { domain, source_name, source_type, credibility_tier, known_bias, notes } = args;

				await pool.query(
					`INSERT INTO source_credibility (source_domain, source_name, source_type, credibility_tier, known_bias, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_domain) DO UPDATE SET
             source_name = COALESCE($2, source_credibility.source_name),
             source_type = COALESCE($3, source_credibility.source_type),
             credibility_tier = $4,
             known_bias = COALESCE($5, source_credibility.known_bias),
             notes = COALESCE($6, source_credibility.notes)`,
					[domain, source_name, source_type, credibility_tier, known_bias, notes],
				);

				return {
					content: [{ type: "text", text: JSON.stringify({ success: true, domain }) }],
				};
			}

			case "get_verification_scores": {
				const result = await pool.query(`
          SELECT
            subject,
            allegation_type,
            source_credibility_tier,
            corroboration_count,
            primary_doc_verified,
            CASE
              WHEN primary_doc_verified AND corroboration_count >= 3 THEN 'VERIFIED - High Confidence'
              WHEN primary_doc_verified AND corroboration_count >= 1 THEN 'SUPPORTED - Primary Evidence'
              WHEN source_credibility_tier <= 2 THEN 'CREDIBLE SOURCE - Needs Corroboration'
              WHEN source_credibility_tier = 3 AND corroboration_count >= 2 THEN 'PROBABLE - Multiple Sources'
              WHEN source_credibility_tier = 3 THEN 'UNVERIFIED - Single Source'
              WHEN source_credibility_tier >= 4 THEN 'QUESTIONABLE - Low Quality Source'
              ELSE 'UNKNOWN'
            END as verification_status,
            array_length(corroborating_docs, 1) as supporting_docs
          FROM investigation_notes
          ORDER BY
            CASE
              WHEN primary_doc_verified AND corroboration_count >= 3 THEN 1
              WHEN primary_doc_verified THEN 2
              ELSE 5
            END
        `);

				return {
					content: [{ type: "text", text: JSON.stringify({ scores: result.rows }, null, 2) }],
				};
			}

			case "list_accused_perpetrators": {
				const result = await pool.query(`
          SELECT subject, allegation_type, summary, verification_notes
          FROM investigation_notes
          WHERE allegation_type IN ('rape', 'sexual_abuse', 'trafficking', 'childhood_abuse')
          ORDER BY subject
        `);

				return {
					content: [{ type: "text", text: JSON.stringify({ accused: result.rows }, null, 2) }],
				};
			}

			case "list_cleared_individuals": {
				const result = await pool.query(`
          SELECT subject, allegation_type, summary, verification_notes
          FROM investigation_notes
          WHERE allegation_type IN ('cleared', 'not_accused_by_giuffre', 'associate_not_accused', 'event_attendee')
          ORDER BY subject
        `);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ cleared_or_not_accused: result.rows }, null, 2),
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
			content: [{ type: "text", text: `Error: ${error.message}` }],
			isError: true,
		};
	}
});

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Epstein Intelligence MCP server running");
}

main().catch(console.error);
