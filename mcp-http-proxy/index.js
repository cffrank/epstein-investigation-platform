import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'platform',
  user: process.env.POSTGRES_USER || 'investigation',
  password: process.env.POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
});

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'mcp-http-proxy' }));

// MCP-style tool listing
app.get('/tools', (c) => {
  return c.json({
    tools: [
      {
        name: 'query',
        description: 'Execute a read-only SQL query against the PostgreSQL database',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'The SQL query to execute (SELECT only)' }
          },
          required: ['sql']
        }
      },
      {
        name: 'get_schema',
        description: 'Get the schema of a table',
        inputSchema: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Table name' }
          },
          required: ['table']
        }
      },
      {
        name: 'list_tables',
        description: 'List all tables in the database',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_stats',
        description: 'Get document processing statistics',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  });
});

// Execute tool
app.post('/tools/:name', async (c) => {
  const toolName = c.req.param('name');
  const body = await c.req.json().catch(() => ({}));

  try {
    switch (toolName) {
      case 'query': {
        const { sql } = body;
        if (!sql) {
          return c.json({ error: 'sql parameter required' }, 400);
        }
        // Only allow SELECT queries for safety
        const trimmed = sql.trim().toUpperCase();
        if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
          return c.json({ error: 'Only SELECT queries allowed' }, 400);
        }
        const result = await pool.query(sql);
        return c.json({
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields.map(f => ({ name: f.name, dataType: f.dataTypeID }))
        });
      }

      case 'get_schema': {
        const { table } = body;
        if (!table) {
          return c.json({ error: 'table parameter required' }, 400);
        }
        const result = await pool.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position
        `, [table]);
        return c.json({ table, columns: result.rows });
      }

      case 'list_tables': {
        const result = await pool.query(`
          SELECT table_name,
            pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size,
            (SELECT reltuples::bigint FROM pg_class WHERE relname = table_name) as row_estimate
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `);
        return c.json({ tables: result.rows });
      }

      case 'get_stats': {
        const result = await pool.query(`
          SELECT
            COUNT(*) as total_documents,
            COUNT(CASE WHEN text_content IS NOT NULL THEN 1 END) as with_text,
            COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as indexed,
            COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as with_embeddings,
            COUNT(CASE WHEN embedding_status = 'pending' THEN 1 END) as pending_embeddings,
            COUNT(CASE WHEN embedding_status = 'failed' THEN 1 END) as failed_embeddings,
            COUNT(DISTINCT source) as sources
          FROM documents
        `);

        const bySource = await pool.query(`
          SELECT source, COUNT(*) as count,
            COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as completed
          FROM documents
          GROUP BY source
          ORDER BY count DESC
          LIMIT 20
        `);

        return c.json({
          overview: result.rows[0],
          bySource: bySource.rows
        });
      }

      default:
        return c.json({ error: `Unknown tool: ${toolName}` }, 404);
    }
  } catch (error) {
    console.error(`Tool ${toolName} error:`, error);
    return c.json({ error: error.message }, 500);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});

const port = parseInt(process.env.PORT || '3002');
console.log(`MCP HTTP Proxy starting on port ${port}`);
serve({ fetch: app.fetch, port });
