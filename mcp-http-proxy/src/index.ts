import { Hono } from "hono";
import { serve } from "@hono/node-server";
import pg from "pg";
import { createClient, type RedisClientType } from "redis";
import { createHash } from "node:crypto";
import {
	createRequireApiKey,
	buildDocumentStatsQuery,
	buildFulltextSearchQuery,
	buildEntityListQuery,
	type SqlQuery,
} from "@epstein/shared";

const { Pool } = pg;

// Safe defaults: always connect to localhost/internal host, never public IP
const pool = new Pool({
	host: process.env.POSTGRES_HOST || "postgres",
	port: parseInt(process.env.POSTGRES_PORT || "5432"),
	database: process.env.POSTGRES_DB || "platform",
	user: process.env.POSTGRES_USER || "investigation",
	password: process.env.POSTGRES_PASSWORD,
	max: 20,
	idleTimeoutMillis: 30000,
});

// Fail-closed: refuse to start without API key
const API_SECRET_KEY = process.env.API_SECRET_KEY;
if (!API_SECRET_KEY) {
	console.error(
		"FATAL: API_SECRET_KEY not set. Refusing to start without authentication.",
	);
	process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";
const QDRANT_URL = process.env.QDRANT_URL || "http://qdrant:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const NEO4J_URL = process.env.NEO4J_URL || "http://neo4j:7474";
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "";

// --- Redis setup ---
const redis: RedisClientType = createClient({ url: REDIS_URL });
redis.on("error", (err: Error) =>
	console.error("Redis error:", err.message),
);
await redis.connect().catch((err: Error) => {
	console.error("Redis connection failed:", err.message);
});

function cacheKey(sql: string, params?: unknown[]): string {
	const raw = JSON.stringify({ sql, params: params || [] });
	return "qc:" + createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function getTTL(sql: string): number {
	const upper = sql.trim().toUpperCase();
	if (upper.includes("COUNT(*)") && upper.includes("FROM DOCUMENTS"))
		return 300;
	if (upper.includes("INFORMATION_SCHEMA")) return 3600;
	if (upper.includes("WHERE ID =") || upper.includes("WHERE ID = ANY"))
		return 1800;
	if (upper.includes("LIMIT")) return 600;
	return 120;
}

interface CachedQueryResult {
	rows: Record<string, unknown>[];
	rowCount: number | null;
	_cached?: boolean;
}

async function cachedQuery(
	sql: string,
	params?: unknown[],
): Promise<CachedQueryResult> {
	const key = cacheKey(sql, params);

	if (redis.isReady) {
		try {
			const cached = await redis.get(key);
			if (cached) {
				return { ...(JSON.parse(cached) as CachedQueryResult), _cached: true };
			}
		} catch (err) {
			console.error("Redis get error:", (err as Error).message);
		}
	}

	const result = await pool.query(sql, params || []);
	const data: CachedQueryResult = {
		rows: result.rows as Record<string, unknown>[],
		rowCount: result.rowCount,
	};

	if (redis.isReady) {
		const ttl = getTTL(sql);
		try {
			await redis.set(key, JSON.stringify(data), { EX: ttl });
		} catch (err) {
			console.error("Redis set error:", (err as Error).message);
		}
	}

	return data;
}

const app = new Hono();

// Use fail-closed auth guard from @epstein/shared
const requireAuth = createRequireApiKey(API_SECRET_KEY);

app.get("/health", async (c) => {
	const redisOk = redis.isReady;
	return c.json({
		status: "ok",
		service: "mcp-http-proxy",
		redis: redisOk ? "connected" : "disconnected",
	});
});

app.get("/cache/stats", async (c) => {
	if (!redis.isReady) return c.json({ error: "Redis not connected" }, 503);
	const info = await redis.info("stats");
	const keyCount = await redis.dbSize();
	const hits = info.match(/keyspace_hits:(\d+)/)?.[1] || "0";
	const misses = info.match(/keyspace_misses:(\d+)/)?.[1] || "0";
	return c.json({ keys: keyCount, hits, misses });
});

app.post("/cache/flush", requireAuth, async (c) => {
	if (!redis.isReady) return c.json({ error: "Redis not connected" }, 503);
	const flushed = await redis.keys("qc:*");
	if (flushed.length > 0) {
		await redis.del(flushed);
	}
	return c.json({ flushed: flushed.length });
});

app.get("/tools", (c) => {
	return c.json({
		tools: [
			{
				name: "query",
				description:
					"Execute a read-only SQL query (with optional parameterized values)",
				inputSchema: {
					type: "object",
					properties: {
						sql: {
							type: "string",
							description: "SQL query (SELECT/WITH only)",
						},
						params: {
							type: "array",
							description: "Query parameters for $1, $2, etc.",
						},
					},
					required: ["sql"],
				},
			},
			{
				name: "search_documents",
				description: "Full-text search across documents",
				inputSchema: {
					type: "object",
					properties: {
						query: { type: "string" },
						limit: { type: "number" },
						offset: { type: "number" },
						source: { type: "string" },
					},
					required: ["query"],
				},
			},
			{
				name: "get_schema",
				description: "Get the schema of a table",
				inputSchema: {
					type: "object",
					properties: { table: { type: "string" } },
					required: ["table"],
				},
			},
			{
				name: "list_tables",
				description: "List all tables in the database",
				inputSchema: { type: "object", properties: {} },
			},
			{
				name: "get_stats",
				description: "Get document processing statistics",
				inputSchema: { type: "object", properties: {} },
			},
			{
				name: "list_entities",
				description: "List entities with optional type filter",
				inputSchema: {
					type: "object",
					properties: {
						type: { type: "string" },
						limit: { type: "number" },
						offset: { type: "number" },
					},
				},
			},
			{
				name: "get_document",
				description: "Get document by ID",
				inputSchema: {
					type: "object",
					properties: { id: { type: "string" } },
					required: ["id"],
				},
			},
		],
	});
});

// Read-only ad-hoc query endpoint (defense-in-depth: SELECT-only validation)
app.post("/query", requireAuth, async (c) => {
	const body = await c.req.json<{
		sql?: string;
		params?: unknown[];
		noCache?: boolean;
	}>();
	const { sql, params, noCache } = body;
	if (!sql) {
		return c.json({ error: "sql required" }, 400);
	}
	const trimmed = sql.trim().toUpperCase();
	if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
		return c.json({ error: "Only SELECT queries allowed" }, 400);
	}
	try {
		if (noCache) {
			const result = await pool.query(sql, params || []);
			return c.json({
				rows: result.rows as Record<string, unknown>[],
				rowCount: result.rowCount,
			});
		}
		const data = await cachedQuery(sql, params);
		return c.json(data);
	} catch (error) {
		console.error("Query error:", (error as Error).message);
		return c.json({ error: (error as Error).message }, 500);
	}
});

app.post("/tools/:name", requireAuth, async (c) => {
	const toolName = c.req.param("name");
	const body = await c.req.json<Record<string, unknown>>();

	try {
		switch (toolName) {
			case "query": {
				const { sql, params } = body as {
					sql?: string;
					params?: unknown[];
				};
				if (!sql) {
					return c.json({ error: "sql parameter required" }, 400);
				}
				const trimmed = sql.trim().toUpperCase();
				if (
					!trimmed.startsWith("SELECT") &&
					!trimmed.startsWith("WITH")
				) {
					return c.json({ error: "Only SELECT queries allowed" }, 400);
				}
				const data = await cachedQuery(sql, params);
				return c.json(data);
			}

			case "search_documents": {
				const { query, limit, offset, source } = body as {
					query?: string;
					limit?: number;
					offset?: number;
					source?: string;
				};
				if (!query) {
					return c.json({ error: "query parameter required" }, 400);
				}
				const sqlQuery: SqlQuery = buildFulltextSearchQuery(query, {
					limit,
					offset,
					source,
				});
				const data = await cachedQuery(sqlQuery.text, sqlQuery.values);
				return c.json(data);
			}

			case "get_schema": {
				const { table } = body as { table?: string };
				if (!table) {
					return c.json({ error: "table parameter required" }, 400);
				}
				const data = await cachedQuery(
					"SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
					["public", table],
				);
				return c.json({ table, columns: data.rows });
			}

			case "list_tables": {
				const data = await cachedQuery(
					"SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size, (SELECT reltuples::bigint FROM pg_class WHERE relname = table_name) as row_estimate FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
					[],
				);
				return c.json({ tables: data.rows });
			}

			case "get_stats": {
				const statsQuery = buildDocumentStatsQuery();
				const data = await cachedQuery(statsQuery.text, statsQuery.values);
				return c.json({ stats: data.rows });
			}

			case "list_entities": {
				const { type, limit, offset } = body as {
					type?: string;
					limit?: number;
					offset?: number;
				};
				const entityQuery = buildEntityListQuery({ type, limit, offset });
				const data = await cachedQuery(
					entityQuery.text,
					entityQuery.values,
				);
				return c.json(data);
			}

			case "get_document": {
				const { id } = body as { id?: string };
				if (!id) {
					return c.json({ error: "id parameter required" }, 400);
				}
				const data = await cachedQuery(
					"SELECT id, filename, source, doc_type, file_size_bytes, r2_key, extracted_text, page_count, content_hash, created_at FROM documents WHERE id = $1",
					[id],
				);
				if (data.rows.length === 0) {
					return c.json({ error: "Document not found" }, 404);
				}
				return c.json({ document: data.rows[0] });
			}

			default:
				return c.json({ error: "Unknown tool: " + toolName }, 404);
		}
	} catch (error) {
		console.error("Tool " + toolName + " error:", error);
		return c.json({ error: (error as Error).message }, 500);
	}
});

// --- Qdrant proxy (authenticated passthrough) ---
app.post("/qdrant/*", requireAuth, async (c) => {
	const path = c.req.path.replace(/^\/qdrant/, "");
	const body = await c.req.text();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (QDRANT_API_KEY) headers["api-key"] = QDRANT_API_KEY;

	const resp = await fetch(QDRANT_URL + path, {
		method: "POST",
		headers,
		body,
	});
	const data = await resp.text();
	return c.body(data, resp.status as 200, {
		"Content-Type": "application/json",
	});
});

app.get("/qdrant/*", requireAuth, async (c) => {
	const path = c.req.path.replace(/^\/qdrant/, "");
	const headers: Record<string, string> = {};
	if (QDRANT_API_KEY) headers["api-key"] = QDRANT_API_KEY;

	const resp = await fetch(QDRANT_URL + path, { headers });
	const data = await resp.text();
	return c.body(data, resp.status as 200, {
		"Content-Type": "application/json",
	});
});

// --- Neo4j proxy (authenticated passthrough) ---
app.post("/neo4j/*", requireAuth, async (c) => {
	const path = c.req.path.replace(/^\/neo4j/, "");
	const body = await c.req.text();
	const auth = Buffer.from(NEO4J_USER + ":" + NEO4J_PASSWORD).toString(
		"base64",
	);

	const resp = await fetch(NEO4J_URL + path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "Basic " + auth,
		},
		body,
	});
	const data = await resp.text();
	return c.body(data, resp.status as 200, {
		"Content-Type":
			resp.headers.get("Content-Type") || "application/json",
	});
});

process.on("SIGTERM", async () => {
	await redis.quit().catch(() => {});
	await pool.end();
	process.exit(0);
});

const port = parseInt(process.env.PORT || "3002");
console.log("MCP HTTP Proxy starting on port " + port);
serve({ fetch: app.fetch, port });
