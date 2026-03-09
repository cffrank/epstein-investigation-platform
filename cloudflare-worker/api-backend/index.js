import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { serve } from "@hono/node-server";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Hono } from "hono";
import neo4j from "neo4j-driver";
import pdf from "pdf-parse/lib/pdf-parse.js";
import pg from "pg";

const { Pool } = pg;

// R2 client (S3-compatible)
const r2Client = new S3Client({
	region: "auto",
	endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
	},
});

// Database configuration
const pool = new Pool({
	host: process.env.PG_HOST || "localhost",
	port: Number.parseInt(process.env.PG_PORT || "5432"),
	database: process.env.PG_DATABASE || "platform",
	user: process.env.PG_USER || "investigation",
	password: process.env.PG_PASSWORD,
	ssl: false,
});

// Qdrant client (use HTTP, not HTTPS)
const qdrant = new QdrantClient({
	host: process.env.QDRANT_HOST || "localhost",
	port: Number.parseInt(process.env.QDRANT_PORT || "6333"),
	apiKey: process.env.QDRANT_API_KEY,
	https: false,
});

// Neo4j driver
const neo4jDriver = neo4j.driver(
	`bolt://${process.env.NEO4J_HOST || "localhost"}:${process.env.NEO4J_BOLT_PORT || "7687"}`,
	neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password"),
);

// API key for internal requests from Cloudflare Worker
// Fail-closed: refuse to start without API key
const API_SECRET_KEY = process.env.API_SECRET_KEY;
if (!API_SECRET_KEY) {
	console.error("FATAL: API_SECRET_KEY not set. Refusing to start without authentication.");
	process.exit(1);
}

const app = new Hono();

// Middleware to verify API key (fail-closed: always requires key)
const requireApiKey = async (c, next) => {
	const apiKey = c.req.header("X-API-Key");
	if (!apiKey || apiKey !== API_SECRET_KEY) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
};

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// ============================================
// DOCUMENT SEARCH ENDPOINTS
// ============================================

// Full-text search
app.post("/search", async (c) => {
	try {
		const { query, dataset, limit = 20 } = await c.req.json();
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

		return c.json({
			query,
			count: result.rows.length,
			documents: result.rows,
		});
	} catch (error) {
		console.error("Search error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Vector search via Qdrant
app.post("/vector-search", async (c) => {
	try {
		const { vector, limit = 10, filters } = await c.req.json();

		const searchResult = await qdrant.search("document_embeddings_v2", {
			vector,
			limit,
			with_payload: true,
			filter: filters,
		});

		return c.json({
			count: searchResult.length,
			results: searchResult,
		});
	} catch (error) {
		console.error("Vector search error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Get sync stats (must be defined BEFORE /documents/:filename)
app.get("/documents/sync-stats", requireApiKey, async (c) => {
	try {
		const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(r2_key) as with_r2_key,
        COUNT(*) - COUNT(r2_key) as missing_r2_key,
        COUNT(CASE WHEN embedding_status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN embedding_status = 'failed' THEN 1 END) as failed
      FROM documents
    `);

		const byPrefix = await pool.query(`
      SELECT
        CASE
          WHEN r2_key LIKE 'dataset_%' THEN split_part(r2_key, '/', 1)
          WHEN r2_key LIKE 'documents/%' THEN 'documents/...'
          WHEN r2_key LIKE 'epstein-docs/%' THEN 'epstein-docs/...'
          WHEN r2_key IS NULL THEN 'NO_R2_KEY'
          ELSE 'other'
        END as prefix,
        COUNT(*) as count
      FROM documents
      GROUP BY 1
      ORDER BY count DESC
    `);

		return c.json({
			overview: stats.rows[0],
			byPrefix: byPrefix.rows,
		});
	} catch (error) {
		console.error("Sync stats error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Sync R2 keys with database - match by filename and update r2_key
app.post("/documents/sync-r2-keys", requireApiKey, async (c) => {
	try {
		const { r2Keys } = await c.req.json();

		if (!r2Keys || !Array.isArray(r2Keys)) {
			return c.json({ error: "r2Keys array required" }, 400);
		}

		let updated = 0;
		let notFound = 0;
		let alreadySet = 0;

		for (const r2Key of r2Keys) {
			const key = typeof r2Key === "string" ? r2Key : r2Key.key;

			// Extract filename from r2 key (last part of path)
			const filename = key.split("/").pop();

			if (!filename) continue;

			// Find document by filename where r2_key is wrong or null
			const result = await pool.query(
				`
        UPDATE documents
        SET r2_key = $1,
            embedding_status = CASE
              WHEN embedding_status = 'failed' THEN 'pending'
              ELSE embedding_status
            END
        WHERE filename = $2
          AND (r2_key IS NULL OR r2_key != $1)
        RETURNING id
      `,
				[key, filename],
			);

			if (result.rowCount > 0) {
				updated++;
			} else {
				// Check if it's already set correctly
				const check = await pool.query(
					"SELECT id FROM documents WHERE filename = $1 AND r2_key = $2",
					[filename, key],
				);
				if (check.rowCount > 0) {
					alreadySet++;
				} else {
					notFound++;
				}
			}
		}

		return c.json({
			success: true,
			processed: r2Keys.length,
			updated,
			alreadySet,
			notFound,
		});
	} catch (error) {
		console.error("Sync R2 keys error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Get unprocessed documents (must be defined BEFORE /documents/:filename)
// This endpoint is called by Cloudflare Worker via nginx /api/ proxy
app.get("/documents/unprocessed", requireApiKey, async (c) => {
	try {
		const limit = Math.min(Number.parseInt(c.req.query("limit") || "100"), 500);
		const source = c.req.query("source");

		let sql = `
      SELECT id as "documentId", r2_key as "r2Key", source, filename
      FROM documents
      WHERE embedding_status = 'pending'
        AND r2_key IS NOT NULL
        AND (r2_key LIKE 'dataset_9/%' OR r2_key LIKE 'dataset_10/%' OR r2_key LIKE 'dataset_11/%')
    `;
		const params = [];

		if (source) {
			params.push(source);
			sql += ` AND source = $${params.length}`;
		}

		params.push(limit);
		sql += ` ORDER BY created_at ASC LIMIT $${params.length}`;

		const result = await pool.query(sql, params);

		return c.json({
			count: result.rows.length,
			documents: result.rows,
		});
	} catch (error) {
		console.error("Unprocessed query error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Get document by filename
app.get("/documents/:filename", async (c) => {
	try {
		const filename = c.req.param("filename");

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
			return c.json({ error: "Document not found" }, 404);
		}

		return c.json(result.rows[0]);
	} catch (error) {
		console.error("Get document error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Database stats
app.get("/stats", async (c) => {
	try {
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

		return c.json({
			overview: stats.rows[0],
			by_dataset: byDataset.rows,
		});
	} catch (error) {
		console.error("Stats error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Count person mentions
app.get("/person/:name/count", async (c) => {
	try {
		const personName = c.req.param("name");

		const result = await pool.query(
			`SELECT COUNT(*) as count
       FROM documents
       WHERE metadata->>'extracted_text' ILIKE $1`,
			[`%${personName}%`],
		);

		return c.json({
			person: personName,
			document_count: Number.parseInt(result.rows[0].count),
		});
	} catch (error) {
		console.error("Person count error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Get documents mentioning a person
app.get("/person/:name/documents", async (c) => {
	try {
		const personName = c.req.param("name");
		const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 50);

		const result = await pool.query(
			`SELECT
        filename,
        source,
        metadata->>'summary' as summary,
        substring(metadata->>'extracted_text' from 1 for 500) as text_preview
      FROM documents
      WHERE metadata->>'extracted_text' ILIKE $1
      LIMIT $2`,
			[`%${personName}%`, limit],
		);

		return c.json({
			person: personName,
			count: result.rows.length,
			documents: result.rows,
		});
	} catch (error) {
		console.error("Person documents error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// ============================================
// INTELLIGENCE ENDPOINTS
// ============================================

// Get subject intelligence
app.get("/intelligence/:subject", async (c) => {
	try {
		const subject = c.req.param("subject");

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

		return c.json({
			subject,
			investigation_notes: notes.rows,
			tagged_documents: tags.rows,
		});
	} catch (error) {
		console.error("Intelligence error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// List all subjects
app.get("/intelligence", async (c) => {
	try {
		const result = await pool.query(`
      SELECT subject, allegation_type, confidence_level,
             source_credibility_tier, corroboration_count, primary_doc_verified
      FROM investigation_notes
      ORDER BY subject
    `);

		return c.json({ subjects: result.rows });
	} catch (error) {
		console.error("List subjects error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Add investigation note
app.post("/intelligence", async (c) => {
	try {
		const {
			subject,
			allegation_type,
			source_url,
			summary,
			corroborating_docs = [],
			source_credibility_tier,
		} = await c.req.json();

		const result = await pool.query(
			`INSERT INTO investigation_notes
       (subject, allegation_type, source_type, source_url, summary, corroborating_docs, source_credibility_tier)
       VALUES ($1, $2, 'news_coverage', $3, $4, $5, $6)
       RETURNING id`,
			[subject, allegation_type, source_url, summary, corroborating_docs, source_credibility_tier],
		);

		return c.json({ success: true, note_id: result.rows[0].id });
	} catch (error) {
		console.error("Add note error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// List accused perpetrators
app.get("/accused", async (c) => {
	try {
		const result = await pool.query(`
      SELECT subject, allegation_type, summary, verification_notes
      FROM investigation_notes
      WHERE allegation_type IN ('rape', 'sexual_abuse', 'trafficking', 'childhood_abuse')
      ORDER BY subject
    `);

		return c.json({ accused: result.rows });
	} catch (error) {
		console.error("List accused error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// List cleared individuals
app.get("/cleared", async (c) => {
	try {
		const result = await pool.query(`
      SELECT subject, allegation_type, summary, verification_notes
      FROM investigation_notes
      WHERE allegation_type IN ('cleared', 'not_accused_by_giuffre', 'associate_not_accused', 'event_attendee')
      ORDER BY subject
    `);

		return c.json({ cleared_or_not_accused: result.rows });
	} catch (error) {
		console.error("List cleared error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Verification scores
app.get("/verification-scores", async (c) => {
	try {
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

		return c.json({ scores: result.rows });
	} catch (error) {
		console.error("Verification scores error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// ============================================
// SOURCE CREDIBILITY ENDPOINTS
// ============================================

// Check source credibility
app.get("/sources/:domain", async (c) => {
	try {
		const domain = c.req.param("domain");

		const result = await pool.query(
			"SELECT * FROM source_credibility WHERE source_domain ILIKE $1",
			[`%${domain}%`],
		);

		if (result.rows.length === 0) {
			return c.json({
				domain,
				status: "NOT_RATED",
				recommendation: "This source has not been rated. Treat with caution.",
			});
		}

		return c.json(result.rows[0]);
	} catch (error) {
		console.error("Source credibility error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// List all sources
app.get("/sources", async (c) => {
	try {
		const tier = c.req.query("tier");

		let sql = "SELECT * FROM source_credibility";
		const params = [];

		if (tier) {
			sql += " WHERE credibility_tier = $1";
			params.push(Number.parseInt(tier));
		}

		sql += " ORDER BY credibility_tier, source_name";

		const result = await pool.query(sql, params);

		return c.json({ sources: result.rows });
	} catch (error) {
		console.error("List sources error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// ============================================
// ENTITIES ENDPOINT (for Worker compatibility)
// ============================================

app.get("/entities/:id", async (c) => {
	try {
		const id = c.req.param("id");

		// Search for person in documents
		const result = await pool.query(
			`SELECT
        $1 as entity_id,
        COUNT(*) as document_count,
        array_agg(DISTINCT source) as datasets
      FROM documents
      WHERE metadata->>'extracted_text' ILIKE $2
      GROUP BY 1`,
			[id, `%${id.replace(/-/g, " ")}%`],
		);

		if (result.rows.length === 0) {
			return c.json({ error: "Entity not found" }, 404);
		}

		return c.json(result.rows[0]);
	} catch (error) {
		console.error("Entity error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// ============================================
// GRAPH ENDPOINTS (Neo4j)
// ============================================

// Execute Cypher query
app.post("/graph/query", async (c) => {
	const session = neo4jDriver.session();
	try {
		const { query, params = {} } = await c.req.json();

		if (!query) {
			return c.json({ error: "Cypher query required" }, 400);
		}

		// Block destructive queries
		const lowerQuery = query.toLowerCase();
		if (
			lowerQuery.includes("delete") ||
			lowerQuery.includes("remove") ||
			lowerQuery.includes("drop") ||
			lowerQuery.includes("create") ||
			lowerQuery.includes("merge") ||
			lowerQuery.includes("set")
		) {
			return c.json({ error: "Only read queries allowed" }, 403);
		}

		const result = await session.run(query, params);

		const records = result.records.map((record) => {
			const obj = {};
			record.keys.forEach((key, i) => {
				const value = record.get(i);
				obj[key] = neo4jValueToJS(value);
			});
			return obj;
		});

		return c.json({
			count: records.length,
			records,
		});
	} catch (error) {
		console.error("Graph query error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Graph traversal - find connections from a starting node
app.post("/graph/traverse", async (c) => {
	const session = neo4jDriver.session();
	try {
		const { startNode, relationshipTypes = [], maxDepth = 2, limit = 50 } = await c.req.json();

		if (!startNode) {
			return c.json({ error: "startNode required" }, 400);
		}

		const safeDepth = Math.min(maxDepth, 4);
		const safeLimit = Math.min(limit, 100);

		const relPattern =
			relationshipTypes.length > 0
				? `[:${relationshipTypes.join("|")}*1..${safeDepth}]`
				: `[*1..${safeDepth}]`;

		const query = `
      MATCH (start {name: $startNode})
      MATCH path = (start)-${relPattern}-(connected)
      WITH connected, min(length(path)) as distance
      RETURN DISTINCT connected.name as name,
             labels(connected) as labels,
             distance
      ORDER BY distance, name
      LIMIT $limit
    `;

		const result = await session.run(query, { startNode, limit: neo4j.int(safeLimit) });

		const connections = result.records.map((record) => ({
			name: record.get("name"),
			labels: record.get("labels"),
			distance: record.get("distance").toNumber(),
		}));

		return c.json({
			startNode,
			maxDepth: safeDepth,
			count: connections.length,
			connections,
		});
	} catch (error) {
		console.error("Graph traversal error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Find person's network
app.get("/graph/person/:name", async (c) => {
	const session = neo4jDriver.session();
	try {
		const name = decodeURIComponent(c.req.param("name"));
		const depth = Math.min(Number.parseInt(c.req.query("depth") || "1"), 3);

		const query = `
      MATCH (p:Person {name: $name})
      OPTIONAL MATCH (p)-[r]-(connected)
      WITH p, type(r) as relType, connected
      RETURN p.name as person,
             collect(DISTINCT {
               name: connected.name,
               type: labels(connected)[0],
               relationship: relType
             }) as connections
    `;

		const result = await session.run(query, { name });

		if (result.records.length === 0) {
			return c.json({ error: "Person not found in graph" }, 404);
		}

		const record = result.records[0];
		return c.json({
			person: record.get("person"),
			connections: record.get("connections").filter((c) => c.name !== null),
		});
	} catch (error) {
		console.error("Person network error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Find shortest path between two people
app.get("/graph/path", async (c) => {
	const session = neo4jDriver.session();
	try {
		const from = c.req.query("from");
		const to = c.req.query("to");

		if (!from || !to) {
			return c.json({ error: "from and to query params required" }, 400);
		}

		const query = `
      MATCH (start:Person {name: $from}), (end:Person {name: $to})
      MATCH path = shortestPath((start)-[*..6]-(end))
      RETURN [node in nodes(path) | node.name] as nodes,
             [rel in relationships(path) | type(rel)] as relationships,
             length(path) as pathLength
    `;

		const result = await session.run(query, { from, to });

		if (result.records.length === 0) {
			return c.json({
				from,
				to,
				pathFound: false,
				message: "No path found between these entities",
			});
		}

		const record = result.records[0];
		return c.json({
			from,
			to,
			pathFound: true,
			pathLength: record.get("pathLength").toNumber(),
			nodes: record.get("nodes"),
			relationships: record.get("relationships"),
		});
	} catch (error) {
		console.error("Path finding error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Get graph statistics
app.get("/graph/stats", async (c) => {
	const session = neo4jDriver.session();
	try {
		const nodeCountResult = await session.run(`
      MATCH (n)
      RETURN labels(n)[0] as label, count(n) as count
      ORDER BY count DESC
    `);

		const relCountResult = await session.run(`
      MATCH ()-[r]->()
      RETURN type(r) as type, count(r) as count
      ORDER BY count DESC
    `);

		return c.json({
			nodesByLabel: nodeCountResult.records.map((r) => ({
				label: r.get("label"),
				count: r.get("count").toNumber(),
			})),
			relationshipsByType: relCountResult.records.map((r) => ({
				type: r.get("type"),
				count: r.get("count").toNumber(),
			})),
		});
	} catch (error) {
		console.error("Graph stats error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Find all people connected to documents
app.get("/graph/document/:filename/people", async (c) => {
	const session = neo4jDriver.session();
	try {
		const filename = c.req.param("filename");

		const query = `
      MATCH (d:Document {filename: $filename})-[r]-(p:Person)
      RETURN p.name as person, type(r) as relationship
      ORDER BY p.name
    `;

		const result = await session.run(query, { filename });

		return c.json({
			filename,
			people: result.records.map((r) => ({
				name: r.get("person"),
				relationship: r.get("relationship"),
			})),
		});
	} catch (error) {
		console.error("Document people error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// ============================================
// CLOUDFLARE WORKER API ENDPOINTS (/api/...)
// These endpoints are called by the Cloudflare Worker
// ============================================

// Get unprocessed documents (for Cloudflare Worker) - with locking to prevent race conditions
app.get("/api/documents/unprocessed", requireApiKey, async (c) => {
	try {
		const limit = Math.min(Number.parseInt(c.req.query("limit") || "100"), 500);
		const source = c.req.query("source");
		const minSize = Number.parseInt(c.req.query("minSize") || "50000"); // Skip tiny files (likely image-only)
		const maxSize = Number.parseInt(c.req.query("maxSize") || "5000000"); // Skip huge files

		// Use CTE with FOR UPDATE SKIP LOCKED to claim documents atomically
		let sql = `
      WITH claimed AS (
        SELECT id
        FROM documents
        WHERE embedding_status = 'pending'
          AND r2_key IS NOT NULL
          AND file_size_bytes BETWEEN $1 AND $2
    `;
		const params = [minSize, maxSize];

		if (source) {
			params.push(source);
			sql += ` AND source = $${params.length}`;
		}

		params.push(limit);
		sql += `
        ORDER BY RANDOM()
        LIMIT $${params.length}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE documents d
      SET embedding_status = 'processing'
      FROM claimed c
      WHERE d.id = c.id
      RETURNING d.id as "documentId", d.r2_key as "r2Key", d.source, d.filename, d.file_size_bytes
    `;

		const result = await pool.query(sql, params);

		return c.json({
			count: result.rows.length,
			documents: result.rows,
		});
	} catch (error) {
		console.error("Get unprocessed error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Extract text from document (for Cloudflare Worker)
app.post("/api/extract", requireApiKey, async (c) => {
	try {
		const { r2Key, documentId, pdfContent } = await c.req.json();

		let pdfBuffer;

		// If PDF content is provided (from Worker), use it directly
		if (pdfContent) {
			pdfBuffer = Buffer.from(pdfContent, "base64");
		} else if (r2Key) {
			// Fallback to fetching from R2 if no content provided
			const command = new GetObjectCommand({
				Bucket: process.env.R2_BUCKET || "epstein-documents",
				Key: r2Key,
			});
			const response = await r2Client.send(command);
			pdfBuffer = Buffer.from(await response.Body.transformToByteArray());
		} else {
			return c.json({ error: "pdfContent or r2Key required" }, 400);
		}

		// Extract text
		let data;
		let text = "";
		let needsOcr = false;

		try {
			data = await pdf(pdfBuffer);
			text = data.text?.trim() || "";

			// Check if it's an image-based PDF (little to no text extracted)
			if (text.length < 50 && data.numpages > 0) {
				needsOcr = true;
			}
		} catch (pdfError) {
			// PDF parsing failed - likely image-based or corrupted
			console.log(`PDF parse failed for ${documentId}: ${pdfError.message}`);
			needsOcr = true;
			data = { numpages: 0 };
		}

		// Update document in PostgreSQL
		if (documentId) {
			if (needsOcr) {
				// Mark for GPU OCR processing
				await pool.query(
					`UPDATE documents
           SET ocr_status = 'needs_ocr',
               embedding_status = 'needs_ocr',
               metadata = jsonb_set(COALESCE(metadata, '{}'), '{needs_ocr}', 'true'::jsonb),
               processed_at = NOW()
           WHERE id = $1`,
					[documentId],
				);
				return c.json({
					documentId,
					r2Key,
					text: "",
					pageCount: data.numpages || 0,
					needsOcr: true,
					message: "Document marked for GPU OCR processing",
				});
			}
			if (text.length > 50) {
				await pool.query(
					`UPDATE documents
           SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{extracted_text}', $1::jsonb),
               ocr_status = 'completed',
               processed_at = NOW()
           WHERE id = $2`,
					[JSON.stringify(text.slice(0, 50000)), documentId],
				);
			}
		}

		return c.json({
			documentId,
			r2Key,
			text: text.slice(0, 8000),
			pageCount: data.numpages || 0,
			needsOcr: false,
		});
	} catch (error) {
		console.error("Extract error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Store embeddings in Qdrant (for Cloudflare Worker)
app.post("/api/embeddings", requireApiKey, async (c) => {
	try {
		const { documentId, embedding, metadata = {} } = await c.req.json();

		if (!documentId || !embedding) {
			return c.json({ error: "documentId and embedding required" }, 400);
		}

		// Get document info from PostgreSQL
		const docResult = await pool.query(
			"SELECT filename, source, r2_key FROM documents WHERE id = $1",
			[documentId],
		);

		if (docResult.rows.length === 0) {
			return c.json({ error: "Document not found" }, 404);
		}

		const doc = docResult.rows[0];

		// Generate a numeric ID for Qdrant (hash of UUID)
		const pointId = Math.abs(hashCode(documentId)) % Number.MAX_SAFE_INTEGER;

		// Upsert to Qdrant
		await qdrant.upsert("document_embeddings_v2", {
			wait: true,
			points: [
				{
					id: pointId,
					vector: embedding,
					payload: {
						document_id: documentId,
						filename: doc.filename,
						source: doc.source,
						r2_key: doc.r2_key,
						...metadata,
					},
				},
			],
		});

		// Update document status in PostgreSQL
		await pool.query(
			`UPDATE documents
       SET embedding_status = 'completed',
           search_vector = to_tsvector('english', COALESCE(metadata->>'extracted_text', ''))
       WHERE id = $1`,
			[documentId],
		);

		return c.json({
			success: true,
			documentId,
			pointId,
		});
	} catch (error) {
		console.error("Store embedding error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Store entities in Neo4j (for Cloudflare Worker)
app.post("/api/entities/batch", requireApiKey, async (c) => {
	const session = neo4jDriver.session();
	try {
		const { documentId, entities, metadata = {} } = await c.req.json();

		if (!documentId) {
			return c.json({ error: "documentId required" }, 400);
		}

		// Get document info
		const docResult = await pool.query("SELECT filename, source FROM documents WHERE id = $1", [
			documentId,
		]);

		if (docResult.rows.length === 0) {
			return c.json({ error: "Document not found" }, 404);
		}

		const doc = docResult.rows[0];

		// Parse entities if string
		let parsedEntities = entities;
		if (typeof entities === "string") {
			try {
				parsedEntities = JSON.parse(entities);
			} catch (e) {
				// Try to extract JSON from the response
				const match = entities.match(/\{[\s\S]*\}/);
				if (match) {
					parsedEntities = JSON.parse(match[0]);
				} else {
					return c.json({ error: "Invalid entities format" }, 400);
				}
			}
		}

		const { people = [], organizations = [], locations = [], dates = [] } = parsedEntities || {};

		let created = 0;

		// Create Document node
		await session.run(
			`MERGE (d:Document {filename: $filename})
       SET d.source = $source, d.document_id = $documentId`,
			{ filename: doc.filename, source: doc.source, documentId },
		);

		// Create Person nodes and relationships
		for (const person of people) {
			if (person?.trim() && person.trim().length > 2) {
				await session.run(
					`MERGE (p:Person {name: $name})
           WITH p
           MATCH (d:Document {filename: $filename})
           MERGE (p)-[:MENTIONED_IN]->(d)`,
					{ name: person.trim(), filename: doc.filename },
				);
				created++;
			}
		}

		// Create Organization nodes and relationships
		for (const org of organizations) {
			if (org?.trim() && org.trim().length > 2) {
				await session.run(
					`MERGE (o:Organization {name: $name})
           WITH o
           MATCH (d:Document {filename: $filename})
           MERGE (o)-[:MENTIONED_IN]->(d)`,
					{ name: org.trim(), filename: doc.filename },
				);
				created++;
			}
		}

		// Create Location nodes and relationships
		for (const loc of locations) {
			if (loc?.trim() && loc.trim().length > 2) {
				await session.run(
					`MERGE (l:Location {name: $name})
           WITH l
           MATCH (d:Document {filename: $filename})
           MERGE (l)-[:MENTIONED_IN]->(d)`,
					{ name: loc.trim(), filename: doc.filename },
				);
				created++;
			}
		}

		return c.json({
			success: true,
			documentId,
			entitiesCreated: created,
			counts: {
				people: people.length,
				organizations: organizations.length,
				locations: locations.length,
				dates: dates.length,
			},
		});
	} catch (error) {
		console.error("Store entities error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Vector search (for Cloudflare Worker)
app.post("/api/search", requireApiKey, async (c) => {
	try {
		const { vector, limit = 10, filters } = await c.req.json();

		if (!vector || !Array.isArray(vector)) {
			return c.json({ error: "vector array required" }, 400);
		}

		const searchResult = await qdrant.search("document_embeddings_v2", {
			vector,
			limit,
			with_payload: true,
			filter: filters,
		});

		return c.json({
			count: searchResult.length,
			results: searchResult,
		});
	} catch (error) {
		console.error("Vector search error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Face search placeholder (for Cloudflare Worker)
app.post("/api/faces/search", requireApiKey, async (c) => {
	return c.json({
		count: 0,
		results: [],
		message: "Face search not yet implemented",
	});
});

// Graph query (for Cloudflare Worker)
app.post("/api/graph/query", requireApiKey, async (c) => {
	const session = neo4jDriver.session();
	try {
		const { query, params = {} } = await c.req.json();

		if (!query) {
			return c.json({ error: "Cypher query required" }, 400);
		}

		// Block destructive queries
		const lowerQuery = query.toLowerCase();
		if (
			lowerQuery.includes("delete") ||
			lowerQuery.includes("remove") ||
			lowerQuery.includes("drop") ||
			lowerQuery.includes("create") ||
			lowerQuery.includes("merge") ||
			lowerQuery.includes("set")
		) {
			return c.json({ error: "Only read queries allowed" }, 403);
		}

		const result = await session.run(query, params);

		const records = result.records.map((record) => {
			const obj = {};
			record.keys.forEach((key, i) => {
				const value = record.get(i);
				obj[key] = neo4jValueToJS(value);
			});
			return obj;
		});

		return c.json({
			count: records.length,
			records,
		});
	} catch (error) {
		console.error("Graph query error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Graph traversal (for Cloudflare Worker)
app.post("/api/graph/traverse", requireApiKey, async (c) => {
	const session = neo4jDriver.session();
	try {
		const { startNode, relationshipTypes = [], maxDepth = 2, limit = 50 } = await c.req.json();

		if (!startNode) {
			return c.json({ error: "startNode required" }, 400);
		}

		const safeDepth = Math.min(maxDepth, 4);
		const safeLimit = Math.min(limit, 100);

		const relPattern =
			relationshipTypes.length > 0
				? `[:${relationshipTypes.join("|")}*1..${safeDepth}]`
				: `[*1..${safeDepth}]`;

		const query = `
      MATCH (start {name: $startNode})
      MATCH path = (start)-${relPattern}-(connected)
      WITH connected, min(length(path)) as distance
      RETURN DISTINCT connected.name as name,
             labels(connected) as labels,
             distance
      ORDER BY distance, name
      LIMIT $limit
    `;

		const result = await session.run(query, { startNode, limit: neo4j.int(safeLimit) });

		const connections = result.records.map((record) => ({
			name: record.get("name"),
			labels: record.get("labels"),
			distance: record.get("distance").toNumber(),
		}));

		return c.json({
			startNode,
			maxDepth: safeDepth,
			count: connections.length,
			connections,
		});
	} catch (error) {
		console.error("Graph traversal error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Entity lookup (for Cloudflare Worker)
app.get("/api/entities/:id", requireApiKey, async (c) => {
	try {
		const id = c.req.param("id");

		const result = await pool.query(
			`SELECT
        $1 as entity_id,
        COUNT(*) as document_count,
        array_agg(DISTINCT source) as datasets
      FROM documents
      WHERE metadata->>'extracted_text' ILIKE $2
      GROUP BY 1`,
			[id, `%${id.replace(/-/g, " ")}%`],
		);

		if (result.rows.length === 0) {
			return c.json({ error: "Entity not found" }, 404);
		}

		return c.json(result.rows[0]);
	} catch (error) {
		console.error("Entity error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// ============================================
// DOCUMENT PROCESSING ENDPOINTS (legacy)
// ============================================

// Extract text from PDF in R2 (for Cloudflare Worker via nginx /api/ proxy)
app.post("/extract", requireApiKey, async (c) => {
	try {
		const { r2Key, documentId, pdfContent } = await c.req.json();

		let pdfBuffer;

		// If PDF content is provided (from Worker), use it directly
		if (pdfContent) {
			pdfBuffer = Buffer.from(pdfContent, "base64");
		} else if (r2Key) {
			// Fallback to fetching from R2 if no content provided
			const command = new GetObjectCommand({
				Bucket: process.env.R2_BUCKET || "epstein-documents",
				Key: r2Key,
			});
			const response = await r2Client.send(command);
			pdfBuffer = Buffer.from(await response.Body.transformToByteArray());
		} else {
			return c.json({ error: "pdfContent or r2Key required" }, 400);
		}

		// Extract text
		const data = await pdf(pdfBuffer);
		const text = data.text?.slice(0, 8000) || "";

		// Update document in PostgreSQL
		if (documentId && text.length > 50) {
			await pool.query(
				`UPDATE documents
         SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{extracted_text}', $1::jsonb),
             ocr_status = 'completed',
             processed_at = NOW()
         WHERE id = $2`,
				[JSON.stringify(text.slice(0, 50000)), documentId],
			);
		}

		return c.json({
			documentId,
			r2Key,
			text,
			pageCount: data.numpages,
		});
	} catch (error) {
		console.error("Text extraction error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Store completed document processing results
app.post("/documents/complete", async (c) => {
	try {
		const { documentId, r2Key, source, text, pageCount, embedding, entities, metadata } =
			await c.req.json();

		// Update PostgreSQL with extracted text
		await pool.query(
			`
      UPDATE documents
      SET metadata = metadata || $1::jsonb,
          page_count = COALESCE($2, page_count)
      WHERE id = $3 OR filename = $4
    `,
			[
				JSON.stringify({ extracted_text: text, entities }),
				pageCount,
				documentId,
				r2Key.split("/").pop(),
			],
		);

		// Store embedding in Qdrant if provided
		if (embedding && embedding.length > 0) {
			try {
				await qdrant.upsert("document_embeddings_v2", {
					wait: true,
					points: [
						{
							id: documentId,
							vector: embedding,
							payload: {
								filename: r2Key.split("/").pop(),
								source,
								r2_key: r2Key,
							},
						},
					],
				});
			} catch (e) {
				console.error("Qdrant upsert error:", e.message);
			}
		}

		// Store entities in Neo4j if provided
		if (entities && (entities.people?.length > 0 || entities.organizations?.length > 0)) {
			const session = neo4jDriver.session();
			try {
				const filename = r2Key.split("/").pop();

				// Create document node
				await session.run(
					`
          MERGE (d:Document {filename: $filename})
          SET d.doc_id = $docId, d.source = $source
        `,
					{ filename, docId: documentId, source },
				);

				// Create person nodes and relationships
				for (const person of entities.people || []) {
					if (person && person.length > 2) {
						await session.run(
							`
              MERGE (p:Person {name: $name})
              WITH p
              MATCH (d:Document {filename: $filename})
              MERGE (p)-[:MENTIONED_IN]->(d)
            `,
							{ name: person, filename },
						);
					}
				}

				// Create org nodes
				for (const org of entities.organizations || []) {
					if (org && org.length > 2) {
						await session.run(
							`
              MERGE (o:Organization {name: $name})
              WITH o
              MATCH (d:Document {filename: $filename})
              MERGE (o)-[:MENTIONED_IN]->(d)
            `,
							{ name: org, filename },
						);
					}
				}
			} finally {
				await session.close();
			}
		}

		return c.json({ success: true, documentId });
	} catch (error) {
		console.error("Document complete error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Get processing stats
app.get("/processing/stats", async (c) => {
	try {
		const result = await pool.query(`
      SELECT
        source,
        COUNT(*) as total,
        SUM(CASE WHEN metadata->>'extracted_text' IS NOT NULL AND metadata->>'extracted_text' != '' THEN 1 ELSE 0 END) as processed,
        SUM(CASE WHEN metadata->>'extracted_text' IS NULL OR metadata->>'extracted_text' = '' THEN 1 ELSE 0 END) as unprocessed
      FROM documents
      WHERE r2_key IS NOT NULL
      GROUP BY source
      ORDER BY unprocessed DESC
    `);

		const totals = result.rows.reduce(
			(acc, r) => ({
				total: acc.total + Number.parseInt(r.total),
				processed: acc.processed + Number.parseInt(r.processed),
				unprocessed: acc.unprocessed + Number.parseInt(r.unprocessed),
			}),
			{ total: 0, processed: 0, unprocessed: 0 },
		);

		return c.json({
			totals,
			bySource: result.rows,
		});
	} catch (error) {
		console.error("Processing stats error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Store embedding directly (for Cloudflare Worker via nginx /api/ proxy)
app.post("/embeddings", requireApiKey, async (c) => {
	try {
		const { documentId, embedding, metadata = {} } = await c.req.json();

		if (!documentId || !embedding) {
			return c.json({ error: "documentId and embedding required" }, 400);
		}

		// Get document info from PostgreSQL
		const docResult = await pool.query(
			"SELECT filename, source, r2_key FROM documents WHERE id = $1",
			[documentId],
		);

		if (docResult.rows.length === 0) {
			return c.json({ error: "Document not found" }, 404);
		}

		const doc = docResult.rows[0];

		// Generate a numeric ID for Qdrant (hash of UUID)
		const pointId = Math.abs(hashCode(documentId)) % Number.MAX_SAFE_INTEGER;

		// Upsert to Qdrant
		await qdrant.upsert("document_embeddings_v2", {
			wait: true,
			points: [
				{
					id: pointId,
					vector: embedding,
					payload: {
						document_id: documentId,
						filename: doc.filename,
						source: doc.source,
						r2_key: doc.r2_key,
						...metadata,
					},
				},
			],
		});

		// Update document status in PostgreSQL
		await pool.query(
			`UPDATE documents
       SET embedding_status = 'completed',
           search_vector = to_tsvector('english', COALESCE(metadata->>'extracted_text', ''))
       WHERE id = $1`,
			[documentId],
		);

		return c.json({ success: true, documentId, pointId });
	} catch (error) {
		console.error("Embedding storage error:", error);
		return c.json({ error: error.message }, 500);
	}
});

// Store entities in Neo4j (for Cloudflare Worker via nginx /api/ proxy)
app.post("/entities/batch", requireApiKey, async (c) => {
	const session = neo4jDriver.session();
	try {
		const { documentId, entities, metadata = {} } = await c.req.json();

		if (!documentId) {
			return c.json({ error: "documentId required" }, 400);
		}

		// Get document info
		const docResult = await pool.query("SELECT filename, source FROM documents WHERE id = $1", [
			documentId,
		]);

		if (docResult.rows.length === 0) {
			return c.json({ error: "Document not found" }, 404);
		}

		const doc = docResult.rows[0];

		// Parse entities if string
		let parsedEntities = entities;
		if (typeof entities === "string") {
			try {
				parsedEntities = JSON.parse(entities);
			} catch (e) {
				const match = entities.match(/\{[\s\S]*\}/);
				if (match) {
					parsedEntities = JSON.parse(match[0]);
				} else {
					return c.json({ error: "Invalid entities format" }, 400);
				}
			}
		}

		const { people = [], organizations = [], locations = [], dates = [] } = parsedEntities || {};
		let created = 0;

		// Create Document node
		await session.run(
			`MERGE (d:Document {filename: $filename})
       SET d.source = $source, d.document_id = $documentId`,
			{ filename: doc.filename, source: doc.source, documentId },
		);

		// Create Person nodes and relationships
		for (const person of people) {
			if (person?.trim() && person.trim().length > 2) {
				await session.run(
					`MERGE (p:Person {name: $name})
           WITH p
           MATCH (d:Document {filename: $filename})
           MERGE (p)-[:MENTIONED_IN]->(d)`,
					{ name: person.trim(), filename: doc.filename },
				);
				created++;
			}
		}

		// Create Organization nodes
		for (const org of organizations) {
			if (org?.trim() && org.trim().length > 2) {
				await session.run(
					`MERGE (o:Organization {name: $name})
           WITH o
           MATCH (d:Document {filename: $filename})
           MERGE (o)-[:MENTIONED_IN]->(d)`,
					{ name: org.trim(), filename: doc.filename },
				);
				created++;
			}
		}

		// Create Location nodes
		for (const loc of locations) {
			if (loc?.trim() && loc.trim().length > 2) {
				await session.run(
					`MERGE (l:Location {name: $name})
           WITH l
           MATCH (d:Document {filename: $filename})
           MERGE (l)-[:MENTIONED_IN]->(d)`,
					{ name: loc.trim(), filename: doc.filename },
				);
				created++;
			}
		}

		return c.json({
			success: true,
			documentId,
			entitiesCreated: created,
		});
	} catch (error) {
		console.error("Store entities error:", error);
		return c.json({ error: error.message }, 500);
	} finally {
		await session.close();
	}
});

// Hash function for generating numeric IDs for Qdrant
function hashCode(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
}

// Helper function to convert Neo4j values to JS
function neo4jValueToJS(value) {
	if (value === null || value === undefined) return null;
	if (neo4j.isInt(value)) return value.toNumber();
	if (Array.isArray(value)) return value.map(neo4jValueToJS);
	if (typeof value === "object" && value.properties) {
		// Node or Relationship
		return {
			...Object.fromEntries(
				Object.entries(value.properties).map(([k, v]) => [k, neo4jValueToJS(v)]),
			),
			_labels: value.labels,
			_type: value.type,
		};
	}
	if (typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neo4jValueToJS(v)]));
	}
	return value;
}

// 404 handler
app.notFound((c) => c.json({ error: "Not Found", path: c.req.path }, 404));

// Error handler
app.onError((err, c) => {
	console.error("Unhandled error:", err);
	return c.json({ error: "Internal Server Error" }, 500);
});

// Start server
const port = Number.parseInt(process.env.PORT || "3000");
console.log(`Epstein API Backend starting on port ${port}...`);

serve(
	{
		fetch: app.fetch,
		port,
		hostname: "0.0.0.0",
	},
	(info) => {
		console.log(`Server running at http://0.0.0.0:${info.port}`);
	},
);
