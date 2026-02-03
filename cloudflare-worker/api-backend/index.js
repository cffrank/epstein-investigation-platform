import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';
import neo4j from 'neo4j-driver';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const { Pool } = pg;

// R2 client (S3-compatible)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

// Database configuration
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'platform',
  user: process.env.PG_USER || 'investigation',
  password: process.env.PG_PASSWORD,
  ssl: false,
});

// Qdrant client
const qdrant = new QdrantClient({
  host: process.env.QDRANT_HOST || 'localhost',
  port: parseInt(process.env.QDRANT_PORT || '6333'),
  apiKey: process.env.QDRANT_API_KEY,
});

// Neo4j driver
const neo4jDriver = neo4j.driver(
  `bolt://${process.env.NEO4J_HOST || 'localhost'}:${process.env.NEO4J_BOLT_PORT || '7687'}`,
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'password'
  )
);

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// ============================================
// DOCUMENT SEARCH ENDPOINTS
// ============================================

// Full-text search
app.post('/search', async (c) => {
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
      sql += ` AND source = $2`;
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
    console.error('Search error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Vector search via Qdrant
app.post('/vector-search', async (c) => {
  try {
    const { vector, limit = 10, filters } = await c.req.json();

    const searchResult = await qdrant.search('document_embeddings', {
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
    console.error('Vector search error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get document by filename
app.get('/documents/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');

    const result = await pool.query(
      `SELECT
        filename, source, doc_type, page_count, file_size_bytes,
        metadata->>'summary' as summary,
        metadata->>'extracted_text' as extracted_text,
        r2_key,
        created_at
      FROM documents
      WHERE filename = $1`,
      [filename]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Document not found' }, 404);
    }

    return c.json(result.rows[0]);
  } catch (error) {
    console.error('Get document error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Database stats
app.get('/stats', async (c) => {
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
    console.error('Stats error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Count person mentions
app.get('/person/:name/count', async (c) => {
  try {
    const personName = c.req.param('name');

    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM documents
       WHERE metadata->>'extracted_text' ILIKE $1`,
      [`%${personName}%`]
    );

    return c.json({
      person: personName,
      document_count: parseInt(result.rows[0].count),
    });
  } catch (error) {
    console.error('Person count error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get documents mentioning a person
app.get('/person/:name/documents', async (c) => {
  try {
    const personName = c.req.param('name');
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);

    const result = await pool.query(
      `SELECT
        filename,
        source,
        metadata->>'summary' as summary,
        substring(metadata->>'extracted_text' from 1 for 500) as text_preview
      FROM documents
      WHERE metadata->>'extracted_text' ILIKE $1
      LIMIT $2`,
      [`%${personName}%`, limit]
    );

    return c.json({
      person: personName,
      count: result.rows.length,
      documents: result.rows,
    });
  } catch (error) {
    console.error('Person documents error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// INTELLIGENCE ENDPOINTS
// ============================================

// Get subject intelligence
app.get('/intelligence/:subject', async (c) => {
  try {
    const subject = c.req.param('subject');

    const notes = await pool.query(
      `SELECT * FROM investigation_notes WHERE subject ILIKE $1`,
      [`%${subject}%`]
    );

    const tags = await pool.query(
      `SELECT at.*, d.filename
       FROM allegation_tags at
       LEFT JOIN documents d ON at.document_id = d.id
       WHERE at.accused_name ILIKE $1`,
      [`%${subject}%`]
    );

    return c.json({
      subject,
      investigation_notes: notes.rows,
      tagged_documents: tags.rows,
    });
  } catch (error) {
    console.error('Intelligence error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// List all subjects
app.get('/intelligence', async (c) => {
  try {
    const result = await pool.query(`
      SELECT subject, allegation_type, confidence_level,
             source_credibility_tier, corroboration_count, primary_doc_verified
      FROM investigation_notes
      ORDER BY subject
    `);

    return c.json({ subjects: result.rows });
  } catch (error) {
    console.error('List subjects error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Add investigation note
app.post('/intelligence', async (c) => {
  try {
    const {
      subject, allegation_type, source_url, summary,
      corroborating_docs = [], source_credibility_tier
    } = await c.req.json();

    const result = await pool.query(
      `INSERT INTO investigation_notes
       (subject, allegation_type, source_type, source_url, summary, corroborating_docs, source_credibility_tier)
       VALUES ($1, $2, 'news_coverage', $3, $4, $5, $6)
       RETURNING id`,
      [subject, allegation_type, source_url, summary, corroborating_docs, source_credibility_tier]
    );

    return c.json({ success: true, note_id: result.rows[0].id });
  } catch (error) {
    console.error('Add note error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// List accused perpetrators
app.get('/accused', async (c) => {
  try {
    const result = await pool.query(`
      SELECT subject, allegation_type, summary, verification_notes
      FROM investigation_notes
      WHERE allegation_type IN ('rape', 'sexual_abuse', 'trafficking', 'childhood_abuse')
      ORDER BY subject
    `);

    return c.json({ accused: result.rows });
  } catch (error) {
    console.error('List accused error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// List cleared individuals
app.get('/cleared', async (c) => {
  try {
    const result = await pool.query(`
      SELECT subject, allegation_type, summary, verification_notes
      FROM investigation_notes
      WHERE allegation_type IN ('cleared', 'not_accused_by_giuffre', 'associate_not_accused', 'event_attendee')
      ORDER BY subject
    `);

    return c.json({ cleared_or_not_accused: result.rows });
  } catch (error) {
    console.error('List cleared error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Verification scores
app.get('/verification-scores', async (c) => {
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
    console.error('Verification scores error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// SOURCE CREDIBILITY ENDPOINTS
// ============================================

// Check source credibility
app.get('/sources/:domain', async (c) => {
  try {
    const domain = c.req.param('domain');

    const result = await pool.query(
      `SELECT * FROM source_credibility WHERE source_domain ILIKE $1`,
      [`%${domain}%`]
    );

    if (result.rows.length === 0) {
      return c.json({
        domain,
        status: 'NOT_RATED',
        recommendation: 'This source has not been rated. Treat with caution.',
      });
    }

    return c.json(result.rows[0]);
  } catch (error) {
    console.error('Source credibility error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// List all sources
app.get('/sources', async (c) => {
  try {
    const tier = c.req.query('tier');

    let sql = `SELECT * FROM source_credibility`;
    const params = [];

    if (tier) {
      sql += ` WHERE credibility_tier = $1`;
      params.push(parseInt(tier));
    }

    sql += ` ORDER BY credibility_tier, source_name`;

    const result = await pool.query(sql, params);

    return c.json({ sources: result.rows });
  } catch (error) {
    console.error('List sources error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// ENTITIES ENDPOINT (for Worker compatibility)
// ============================================

app.get('/entities/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Search for person in documents
    const result = await pool.query(
      `SELECT
        $1 as entity_id,
        COUNT(*) as document_count,
        array_agg(DISTINCT source) as datasets
      FROM documents
      WHERE metadata->>'extracted_text' ILIKE $2
      GROUP BY 1`,
      [id, `%${id.replace(/-/g, ' ')}%`]
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    return c.json(result.rows[0]);
  } catch (error) {
    console.error('Entity error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ============================================
// GRAPH ENDPOINTS (Neo4j)
// ============================================

// Execute Cypher query
app.post('/graph/query', async (c) => {
  const session = neo4jDriver.session();
  try {
    const { query, params = {} } = await c.req.json();

    if (!query) {
      return c.json({ error: 'Cypher query required' }, 400);
    }

    // Block destructive queries
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('delete') || lowerQuery.includes('remove') ||
        lowerQuery.includes('drop') || lowerQuery.includes('create') ||
        lowerQuery.includes('merge') || lowerQuery.includes('set')) {
      return c.json({ error: 'Only read queries allowed' }, 403);
    }

    const result = await session.run(query, params);

    const records = result.records.map(record => {
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
    console.error('Graph query error:', error);
    return c.json({ error: error.message }, 500);
  } finally {
    await session.close();
  }
});

// Graph traversal - find connections from a starting node
app.post('/graph/traverse', async (c) => {
  const session = neo4jDriver.session();
  try {
    const { startNode, relationshipTypes = [], maxDepth = 2, limit = 50 } = await c.req.json();

    if (!startNode) {
      return c.json({ error: 'startNode required' }, 400);
    }

    const safeDepth = Math.min(maxDepth, 4);
    const safeLimit = Math.min(limit, 100);

    let relPattern = relationshipTypes.length > 0
      ? `[:${relationshipTypes.join('|')}*1..${safeDepth}]`
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

    const connections = result.records.map(record => ({
      name: record.get('name'),
      labels: record.get('labels'),
      distance: record.get('distance').toNumber(),
    }));

    return c.json({
      startNode,
      maxDepth: safeDepth,
      count: connections.length,
      connections,
    });
  } catch (error) {
    console.error('Graph traversal error:', error);
    return c.json({ error: error.message }, 500);
  } finally {
    await session.close();
  }
});

// Find person's network
app.get('/graph/person/:name', async (c) => {
  const session = neo4jDriver.session();
  try {
    const name = decodeURIComponent(c.req.param('name'));
    const depth = Math.min(parseInt(c.req.query('depth') || '1'), 3);

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
      return c.json({ error: 'Person not found in graph' }, 404);
    }

    const record = result.records[0];
    return c.json({
      person: record.get('person'),
      connections: record.get('connections').filter(c => c.name !== null),
    });
  } catch (error) {
    console.error('Person network error:', error);
    return c.json({ error: error.message }, 500);
  } finally {
    await session.close();
  }
});

// Find shortest path between two people
app.get('/graph/path', async (c) => {
  const session = neo4jDriver.session();
  try {
    const from = c.req.query('from');
    const to = c.req.query('to');

    if (!from || !to) {
      return c.json({ error: 'from and to query params required' }, 400);
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
        message: 'No path found between these entities'
      });
    }

    const record = result.records[0];
    return c.json({
      from,
      to,
      pathFound: true,
      pathLength: record.get('pathLength').toNumber(),
      nodes: record.get('nodes'),
      relationships: record.get('relationships'),
    });
  } catch (error) {
    console.error('Path finding error:', error);
    return c.json({ error: error.message }, 500);
  } finally {
    await session.close();
  }
});

// Get graph statistics
app.get('/graph/stats', async (c) => {
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
      nodesByLabel: nodeCountResult.records.map(r => ({
        label: r.get('label'),
        count: r.get('count').toNumber(),
      })),
      relationshipsByType: relCountResult.records.map(r => ({
        type: r.get('type'),
        count: r.get('count').toNumber(),
      })),
    });
  } catch (error) {
    console.error('Graph stats error:', error);
    return c.json({ error: error.message }, 500);
  } finally {
    await session.close();
  }
});

// Find all people connected to documents
app.get('/graph/document/:filename/people', async (c) => {
  const session = neo4jDriver.session();
  try {
    const filename = c.req.param('filename');

    const query = `
      MATCH (d:Document {filename: $filename})-[r]-(p:Person)
      RETURN p.name as person, type(r) as relationship
      ORDER BY p.name
    `;

    const result = await session.run(query, { filename });

    return c.json({
      filename,
      people: result.records.map(r => ({
        name: r.get('person'),
        relationship: r.get('relationship'),
      })),
    });
  } catch (error) {
    console.error('Document people error:', error);
    return c.json({ error: error.message }, 500);
  } finally {
    await session.close();
  }
});

// ============================================
// DOCUMENT PROCESSING ENDPOINTS
// ============================================

// Extract text from PDF in R2
app.post('/extract', async (c) => {
  try {
    const { r2Key, documentId } = await c.req.json();

    if (!r2Key) {
      return c.json({ error: 'r2Key required' }, 400);
    }

    // Get PDF from R2
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET || 'epstein-documents',
      Key: r2Key,
    });

    const response = await r2Client.send(command);
    const pdfBuffer = Buffer.from(await response.Body.transformToByteArray());

    // Extract text
    const data = await pdf(pdfBuffer);

    return c.json({
      documentId,
      r2Key,
      text: data.text,
      pageCount: data.numpages,
      info: data.info,
    });
  } catch (error) {
    console.error('Text extraction error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Store completed document processing results
app.post('/documents/complete', async (c) => {
  try {
    const { documentId, r2Key, source, text, pageCount, embedding, entities, metadata } = await c.req.json();

    // Update PostgreSQL with extracted text
    await pool.query(`
      UPDATE documents
      SET metadata = metadata || $1::jsonb,
          page_count = COALESCE($2, page_count)
      WHERE id = $3 OR filename = $4
    `, [
      JSON.stringify({ extracted_text: text, entities }),
      pageCount,
      documentId,
      r2Key.split('/').pop()
    ]);

    // Store embedding in Qdrant if provided
    if (embedding && embedding.length > 0) {
      try {
        await qdrant.upsert('document_embeddings', {
          wait: true,
          points: [{
            id: documentId,
            vector: embedding,
            payload: {
              filename: r2Key.split('/').pop(),
              source,
              r2_key: r2Key,
            },
          }],
        });
      } catch (e) {
        console.error('Qdrant upsert error:', e.message);
      }
    }

    // Store entities in Neo4j if provided
    if (entities && (entities.people?.length > 0 || entities.organizations?.length > 0)) {
      const session = neo4jDriver.session();
      try {
        const filename = r2Key.split('/').pop();

        // Create document node
        await session.run(`
          MERGE (d:Document {filename: $filename})
          SET d.doc_id = $docId, d.source = $source
        `, { filename, docId: documentId, source });

        // Create person nodes and relationships
        for (const person of (entities.people || [])) {
          if (person && person.length > 2) {
            await session.run(`
              MERGE (p:Person {name: $name})
              WITH p
              MATCH (d:Document {filename: $filename})
              MERGE (p)-[:MENTIONED_IN]->(d)
            `, { name: person, filename });
          }
        }

        // Create org nodes
        for (const org of (entities.organizations || [])) {
          if (org && org.length > 2) {
            await session.run(`
              MERGE (o:Organization {name: $name})
              WITH o
              MATCH (d:Document {filename: $filename})
              MERGE (o)-[:MENTIONED_IN]->(d)
            `, { name: org, filename });
          }
        }
      } finally {
        await session.close();
      }
    }

    return c.json({ success: true, documentId });
  } catch (error) {
    console.error('Document complete error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get unprocessed documents (no extracted text)
app.get('/documents/unprocessed', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 1000);
    const source = c.req.query('source');

    let sql = `
      SELECT id, filename, source, r2_key
      FROM documents
      WHERE r2_key IS NOT NULL
        AND (metadata->>'extracted_text' IS NULL OR metadata->>'extracted_text' = '')
    `;
    const params = [];

    if (source) {
      sql += ` AND source = $1`;
      params.push(source);
    }

    sql += ` ORDER BY id LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);

    return c.json({
      count: result.rows.length,
      documents: result.rows.map(r => ({
        documentId: r.id.toString(),
        filename: r.filename,
        source: r.source,
        r2Key: r.r2_key,
      })),
    });
  } catch (error) {
    console.error('Unprocessed query error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get processing stats
app.get('/processing/stats', async (c) => {
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

    const totals = result.rows.reduce((acc, r) => ({
      total: acc.total + parseInt(r.total),
      processed: acc.processed + parseInt(r.processed),
      unprocessed: acc.unprocessed + parseInt(r.unprocessed),
    }), { total: 0, processed: 0, unprocessed: 0 });

    return c.json({
      totals,
      bySource: result.rows,
    });
  } catch (error) {
    console.error('Processing stats error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Store embedding directly
app.post('/embeddings', async (c) => {
  try {
    const { documentId, embedding, metadata } = await c.req.json();

    await qdrant.upsert('document_embeddings', {
      wait: true,
      points: [{
        id: documentId,
        vector: embedding,
        payload: metadata || {},
      }],
    });

    return c.json({ success: true, documentId });
  } catch (error) {
    console.error('Embedding storage error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Helper function to convert Neo4j values to JS
function neo4jValueToJS(value) {
  if (value === null || value === undefined) return null;
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(neo4jValueToJS);
  if (typeof value === 'object' && value.properties) {
    // Node or Relationship
    return {
      ...Object.fromEntries(
        Object.entries(value.properties).map(([k, v]) => [k, neo4jValueToJS(v)])
      ),
      _labels: value.labels,
      _type: value.type,
    };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, neo4jValueToJS(v)])
    );
  }
  return value;
}

// 404 handler
app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Start server
const port = parseInt(process.env.PORT || '3000');
console.log(`Epstein API Backend starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
}, (info) => {
  console.log(`Server running at http://0.0.0.0:${info.port}`);
});
