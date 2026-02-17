import { Hono } from "hono";
import { serve } from "@hono/node-server";
import pg from "pg";
import { createClient } from "redis";
import { createHash } from "node:crypto";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "platform",
  user: process.env.POSTGRES_USER || "investigation",
  password: process.env.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
});

const API_SECRET_KEY = process.env.API_SECRET_KEY || "";
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";

// --- Redis setup ---
const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("Redis error:", err.message));
await redis.connect().catch((err) => {
  console.error("Redis connection failed:", err.message);
});

function cacheKey(sql, params) {
  const raw = JSON.stringify({ sql, params: params || [] });
  return "qc:" + createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

// Determine TTL based on query pattern
function getTTL(sql) {
  const upper = sql.trim().toUpperCase();
  // Stats/aggregation queries - expensive COUNT(*) over 1.4M rows
  if (upper.includes("COUNT(*)") && upper.includes("FROM DOCUMENTS")) return 300; // 5 min
  // Schema/table list queries - very stable
  if (upper.includes("INFORMATION_SCHEMA")) return 3600; // 1 hour
  // Document detail lookups by ID - static data
  if (upper.includes("WHERE ID =") || upper.includes("WHERE ID = ANY")) return 1800; // 30 min
  // Search queries with LIMIT - moderate cache
  if (upper.includes("LIMIT")) return 600; // 10 min
  // Default for other SELECT queries
  return 120; // 2 min
}

async function cachedQuery(sql, params) {
  const key = cacheKey(sql, params);

  // Try cache first
  if (redis.isReady) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        return { ...JSON.parse(cached), _cached: true };
      }
    } catch (err) {
      console.error("Redis get error:", err.message);
    }
  }

  // Run query
  const result = await pool.query(sql, params || []);
  const data = { rows: result.rows, rowCount: result.rowCount };

  // Store in cache
  if (redis.isReady) {
    const ttl = getTTL(sql);
    try {
      await redis.set(key, JSON.stringify(data), { EX: ttl });
    } catch (err) {
      console.error("Redis set error:", err.message);
    }
  }

  return data;
}

const app = new Hono();

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

app.post("/cache/flush", async (c) => {
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
        description: "Execute a read-only SQL query (with optional parameterized values)",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string", description: "SQL query (SELECT/WITH only)" },
            params: { type: "array", description: "Query parameters for $1, $2, etc." }
          },
          required: ["sql"]
        }
      },
      {
        name: "get_schema",
        description: "Get the schema of a table",
        inputSchema: {
          type: "object",
          properties: { table: { type: "string" } },
          required: ["table"]
        }
      },
      {
        name: "list_tables",
        description: "List all tables in the database",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "get_stats",
        description: "Get document processing statistics",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  });
});

const requireAuth = async (c, next) => {
  const apiKey = c.req.header("X-API-Key");
  if (API_SECRET_KEY && apiKey !== API_SECRET_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

// Parameterized query endpoint for the frontend BFF
app.post("/query", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
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
      return c.json({ rows: result.rows, rowCount: result.rowCount });
    }
    const data = await cachedQuery(sql, params);
    return c.json(data);
  } catch (error) {
    console.error("Query error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});

app.post("/tools/:name", async (c) => {
  const toolName = c.req.param("name");
  const body = await c.req.json().catch(() => ({}));

  try {
    switch (toolName) {
      case "query": {
        const { sql, params } = body;
        if (!sql) {
          return c.json({ error: "sql parameter required" }, 400);
        }
        const trimmed = sql.trim().toUpperCase();
        if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
          return c.json({ error: "Only SELECT queries allowed" }, 400);
        }
        const data = await cachedQuery(sql, params);
        return c.json({
          ...data,
          fields: undefined, // tools endpoint used to return fields, keep compat
        });
      }

      case "get_schema": {
        const { table } = body;
        if (!table) {
          return c.json({ error: "table parameter required" }, 400);
        }
        const data = await cachedQuery(
          "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
          ["public", table]
        );
        return c.json({ table, columns: data.rows });
      }

      case "list_tables": {
        const data = await cachedQuery("SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size, (SELECT reltuples::bigint FROM pg_class WHERE relname = table_name) as row_estimate FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name", []);
        return c.json({ tables: data.rows });
      }

      case "get_stats": {
        const overview = await cachedQuery("SELECT COUNT(*) as total_documents, COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as indexed, COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as with_embeddings, COUNT(CASE WHEN embedding_status = 'pending' THEN 1 END) as pending_embeddings, COUNT(CASE WHEN embedding_status = 'failed' THEN 1 END) as failed_embeddings, COUNT(CASE WHEN ocr_status = 'completed' THEN 1 END) as ocr_completed, COUNT(DISTINCT source) as sources FROM documents", []);
        const bySource = await cachedQuery("SELECT source, COUNT(*) as count, COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as completed FROM documents GROUP BY source ORDER BY count DESC LIMIT 20", []);
        return c.json({ overview: overview.rows[0], bySource: bySource.rows });
      }

      default:
        return c.json({ error: "Unknown tool: " + toolName }, 404);
    }
  } catch (error) {
    console.error("Tool " + toolName + " error:", error);
    return c.json({ error: error.message }, 500);
  }
});

process.on("SIGTERM", async () => {
  await redis.quit().catch(() => {});
  await pool.end();
  process.exit(0);
});

const port = parseInt(process.env.PORT || "3002");
console.log("MCP HTTP Proxy starting on port " + port);
serve({ fetch: app.fetch, port });
