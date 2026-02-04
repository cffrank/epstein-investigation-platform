import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { cache } from 'hono/cache';

// Cloudflare bindings type
type Bindings = {
  DOCUMENTS: R2Bucket;
  CACHE_DB: D1Database;
  SESSIONS: KVNamespace;
  AI: Ai;
  DOCUMENT_QUEUE: Queue<DocumentMessage>;
  DLQ: Queue<DocumentMessage>;
  DOCUMENT_WORKFLOW: Workflow;
  BATCH_WORKFLOW: Workflow;
  API_SECRET_KEY: string;
  AI_GATEWAY_TOKEN: string;
  ORIGIN_URL: string;
  ENVIRONMENT: string;
};

// Workflow type placeholder
interface Workflow {
  create(params: { params: unknown }): Promise<{ id: string }>;
  get(id: string): Promise<{ status: string; output?: unknown }>;
}

// Queue message types
interface DocumentMessage {
  type: 'process_document' | 'generate_embedding' | 'extract_entities';
  documentId: string;
  r2Key?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  attempt?: number;
}

type Variables = {
  requestId: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Request ID middleware for tracing
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  await next();
});

// CORS configuration
app.use('/*', cors({
  origin: ['https://app.epsteinfiles.org', 'https://epsteinfiles.org'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  maxAge: 86400,
}));

// Rate limiting middleware using KV
app.use('/api/*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const key = `ratelimit:${ip}`;

  try {
    const current = await c.env.SESSIONS.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= 100) { // 100 requests per minute
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    await c.env.SESSIONS.put(key, String(count + 1), { expirationTtl: 60 });
  } catch {
    // If KV fails, allow request but log warning
    console.warn('Rate limiting KV unavailable');
  }

  await next();
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
    requestId: c.get('requestId'),
  });
});

// Document retrieval from R2 with caching
app.get(
  '/documents/:key{.+}',
  cache({ cacheName: 'documents', cacheControl: 'public, max-age=86400' }),
  async (c) => {
    const key = c.req.param('key');

    try {
      const object = await c.env.DOCUMENTS.get(key);

      if (!object) {
        return c.json({ error: 'Document not found' }, 404);
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('X-Request-ID', c.get('requestId'));

      return new Response(object.body, { headers });
    } catch (error) {
      console.error('Document retrieval error:', error);
      return c.json({ error: 'Failed to retrieve document' }, 500);
    }
  }
);

// Vector search endpoint with embedding generation
app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { query, limit = 10, filters } = body;

    if (!query || typeof query !== 'string') {
      return c.json({ error: 'Query string required' }, 400);
    }

    // Check search cache in D1
    const queryHash = await hashString(query + JSON.stringify(filters || {}));

    try {
      const cached = await c.env.CACHE_DB.prepare(
        'SELECT results FROM search_cache WHERE query_hash = ? AND expires_at > ?'
      ).bind(queryHash, Date.now()).first<{ results: string }>();

      if (cached) {
        return c.json(JSON.parse(cached.results));
      }
    } catch {
      // Cache miss or D1 unavailable, continue to origin
    }

    // Generate embedding using Workers AI (BGE-base for document search)
    // AI Gateway authentication is required for Zero Trust access
    const embeddingResponse = await c.env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text: [query] },
      {
        gateway: {
          id: 'internal-gateway',
          headers: {
            'cf-aig-authorization': `Bearer ${c.env.AI_GATEWAY_TOKEN}`,
          },
        },
      }
    ) as { data: number[][] };

    if (!embeddingResponse?.data?.[0]) {
      return c.json({ error: 'Failed to generate embedding' }, 500);
    }

    // Forward to origin Qdrant via tunnel
    const response = await fetch(`${c.env.ORIGIN_URL}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.API_SECRET_KEY,
        'X-Request-ID': c.get('requestId'),
      },
      body: JSON.stringify({
        vector: embeddingResponse.data[0],
        limit,
        filters,
      }),
    });

    if (!response.ok) {
      const status = response.status as 502 | 503 | 504;
      return c.json({ error: 'Search service unavailable' }, status);
    }

    const results = await response.json();

    // Cache results in D1 for 10 minutes
    try {
      await c.env.CACHE_DB.prepare(
        'INSERT OR REPLACE INTO search_cache (query_hash, results, expires_at) VALUES (?, ?, ?)'
      ).bind(queryHash, JSON.stringify(results), Date.now() + 600000).run();
    } catch {
      // Cache write failed, non-critical
    }

    return c.json(results);
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

// Entity lookup with D1 caching
app.get('/entities/:id', async (c) => {
  const id = c.req.param('id');

  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    return c.json({ error: 'Invalid entity ID' }, 400);
  }

  try {
    // Check D1 cache first (1 hour TTL as per PRD)
    try {
      const cached = await c.env.CACHE_DB.prepare(
        'SELECT data FROM entity_cache WHERE id = ? AND expires_at > ?'
      ).bind(id, Date.now()).first<{ data: string }>();

      if (cached) {
        return c.json(JSON.parse(cached.data));
      }
    } catch {
      // Cache miss or D1 unavailable
    }

    // Fetch from origin
    const response = await fetch(`${c.env.ORIGIN_URL}/api/entities/${id}`, {
      headers: {
        'X-API-Key': c.env.API_SECRET_KEY,
        'X-Request-ID': c.get('requestId'),
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return c.json({ error: 'Entity not found' }, 404);
      }
      return c.json({ error: 'Entity service unavailable' }, 502);
    }

    const data = await response.json();

    // Cache for 1 hour
    try {
      await c.env.CACHE_DB.prepare(
        'INSERT OR REPLACE INTO entity_cache (id, data, expires_at) VALUES (?, ?, ?)'
      ).bind(id, JSON.stringify(data), Date.now() + 3600000).run();
    } catch {
      // Cache write failed, non-critical
    }

    return c.json(data);
  } catch (error) {
    console.error('Entity lookup error:', error);
    return c.json({ error: 'Failed to retrieve entity' }, 500);
  }
});

// Graph traversal (proxied to Neo4j via origin)
app.post('/graph/traverse', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.startNode) {
      return c.json({ error: 'startNode required' }, 400);
    }

    const response = await fetch(`${c.env.ORIGIN_URL}/api/graph/traverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.API_SECRET_KEY,
        'X-Request-ID': c.get('requestId'),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return c.json({ error: 'Graph service unavailable' }, 502);
    }

    return response;
  } catch (error) {
    console.error('Graph traversal error:', error);
    return c.json({ error: 'Graph traversal failed' }, 500);
  }
});

// Graph query endpoint for Cypher queries
app.post('/graph/query', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.query) {
      return c.json({ error: 'Cypher query required' }, 400);
    }

    const response = await fetch(`${c.env.ORIGIN_URL}/api/graph/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.API_SECRET_KEY,
        'X-Request-ID': c.get('requestId'),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return c.json({ error: 'Graph query service unavailable' }, 502);
    }

    return response;
  } catch (error) {
    console.error('Graph query error:', error);
    return c.json({ error: 'Graph query failed' }, 500);
  }
});

// Text generation endpoint for entity extraction
app.post('/ai/generate', async (c) => {
  try {
    // Verify API key for internal use
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { prompt, system, max_tokens = 2048 } = body;

    if (!prompt || typeof prompt !== 'string') {
      return c.json({ error: 'Prompt string required' }, 400);
    }

    // Use Llama 3 for entity extraction
    const response = await c.env.AI.run(
      '@cf/meta/llama-3-8b-instruct',
      {
        messages: [
          { role: 'system', content: system || 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ],
        max_tokens,
      },
      {
        gateway: {
          id: 'internal-gateway',
          headers: {
            'cf-aig-authorization': `Bearer ${c.env.AI_GATEWAY_TOKEN}`,
          },
        },
      }
    ) as { response: string };

    return c.json({
      text: response.response,
      model: '@cf/meta/llama-3-8b-instruct',
    });
  } catch (error) {
    console.error('Text generation error:', error);
    return c.json({ error: 'Text generation failed' }, 500);
  }
});

// Embedding generation endpoint for document processing
app.post('/ai/embedding', async (c) => {
  try {
    // Verify API key for internal use
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'Text string required' }, 400);
    }

    // Generate embedding using Workers AI (BGE-base)
    const embeddingResponse = await c.env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text: [text.slice(0, 8000)] }, // Limit text length
      {
        gateway: {
          id: 'internal-gateway',
          headers: {
            'cf-aig-authorization': `Bearer ${c.env.AI_GATEWAY_TOKEN}`,
          },
        },
      }
    ) as { data: number[][] };

    if (!embeddingResponse?.data?.[0]) {
      return c.json({ error: 'Failed to generate embedding' }, 500);
    }

    return c.json({
      embedding: embeddingResponse.data[0],
      dimensions: embeddingResponse.data[0].length,
      model: '@cf/baai/bge-base-en-v1.5',
    });
  } catch (error) {
    console.error('Embedding generation error:', error);
    return c.json({ error: 'Embedding generation failed' }, 500);
  }
});

// Document upload to R2 (internal use only)
app.put('/documents/:key{.+}', async (c) => {
  try {
    // Verify API key for internal use
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const key = c.req.param('key');
    const contentType = c.req.header('Content-Type') || 'application/pdf';
    const body = await c.req.arrayBuffer();

    if (!body || body.byteLength === 0) {
      return c.json({ error: 'Empty body' }, 400);
    }

    // Upload to R2
    await c.env.DOCUMENTS.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    return c.json({
      success: true,
      key,
      size: body.byteLength,
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Document upload error:', error);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// Face search endpoint
app.post('/faces/search', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.embedding && !body.imageUrl) {
      return c.json({ error: 'embedding or imageUrl required' }, 400);
    }

    const response = await fetch(`${c.env.ORIGIN_URL}/api/faces/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.API_SECRET_KEY,
        'X-Request-ID': c.get('requestId'),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return c.json({ error: 'Face search service unavailable' }, 502);
    }

    return response;
  } catch (error) {
    console.error('Face search error:', error);
    return c.json({ error: 'Face search failed' }, 500);
  }
});

// Queue document for processing (batch enqueue)
app.post('/queue/documents', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { documents } = body as { documents: Array<{ id: string; r2Key: string; metadata?: Record<string, unknown> }> };

    if (!documents || !Array.isArray(documents)) {
      return c.json({ error: 'documents array required' }, 400);
    }

    // Batch enqueue - up to 100 messages per batch
    const messages: MessageSendRequest<DocumentMessage>[] = documents.map(doc => ({
      body: {
        type: 'process_document' as const,
        documentId: doc.id,
        r2Key: doc.r2Key,
        metadata: doc.metadata,
        attempt: 1,
      },
    }));

    // Send in batches of 100
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      await c.env.DOCUMENT_QUEUE.sendBatch(batch);
    }

    return c.json({
      success: true,
      queued: documents.length,
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Queue enqueue error:', error);
    return c.json({ error: 'Failed to enqueue documents' }, 500);
  }
});

// Direct batch processing (bypass queue for now)
app.post('/process/batch', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { limit = 10 } = body as { limit?: number };
    const safeLimit = Math.min(limit, 50);

    // Get unprocessed documents
    const url = new URL(`${c.env.ORIGIN_URL}/api/documents/unprocessed`);
    url.searchParams.set('limit', safeLimit.toString());

    const response = await fetch(url.toString(), {
      headers: { 'X-API-Key': c.env.API_SECRET_KEY },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to get documents' }, 502);
    }

    const { documents } = await response.json() as {
      documents: Array<{ documentId: string; r2Key: string; source: string }>
    };

    if (!documents || documents.length === 0) {
      return c.json({ message: 'No unprocessed documents', processed: 0 });
    }

    const results: Array<{ documentId: string; status: string; error?: string }> = [];

    for (const doc of documents) {
      try {
        // Get PDF from R2
        const object = await c.env.DOCUMENTS.get(doc.r2Key);
        if (!object) {
          results.push({ documentId: doc.documentId, status: 'not_found' });
          continue;
        }

        // Read and encode PDF
        const pdfArrayBuffer = await object.arrayBuffer();
        if (pdfArrayBuffer.byteLength > 10 * 1024 * 1024) {
          results.push({ documentId: doc.documentId, status: 'too_large' });
          continue;
        }

        const pdfBytes = new Uint8Array(pdfArrayBuffer);
        let pdfBinary = '';
        const chunkSize = 32768;
        for (let i = 0; i < pdfBytes.length; i += chunkSize) {
          const chunk = pdfBytes.subarray(i, i + chunkSize);
          pdfBinary += String.fromCharCode.apply(null, [...chunk]);
        }
        const pdfBase64 = btoa(pdfBinary);

        // Extract text
        const extractResponse = await fetch(`${c.env.ORIGIN_URL}/api/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': c.env.API_SECRET_KEY,
          },
          body: JSON.stringify({
            r2Key: doc.r2Key,
            documentId: doc.documentId,
            pdfContent: pdfBase64
          }),
        });

        if (!extractResponse.ok) {
          results.push({ documentId: doc.documentId, status: 'extract_failed' });
          continue;
        }

        const { text } = await extractResponse.json() as { text: string };

        if (text && text.length > 100) {
          // Generate embedding
          const embeddingResponse = await c.env.AI.run(
            '@cf/baai/bge-base-en-v1.5',
            { text: [text.slice(0, 8000)] },
            {
              gateway: {
                id: 'internal-gateway',
                headers: {
                  'cf-aig-authorization': `Bearer ${c.env.AI_GATEWAY_TOKEN}`,
                },
              },
            }
          ) as { data: number[][] };

          if (embeddingResponse?.data?.[0]) {
            // Store embedding
            await fetch(`${c.env.ORIGIN_URL}/api/embeddings`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': c.env.API_SECRET_KEY,
              },
              body: JSON.stringify({
                documentId: doc.documentId,
                embedding: embeddingResponse.data[0],
                metadata: { source: doc.source },
              }),
            });
          }
        }

        results.push({ documentId: doc.documentId, status: 'completed' });
      } catch (error) {
        results.push({
          documentId: doc.documentId,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const completed = results.filter(r => r.status === 'completed').length;
    return c.json({
      success: true,
      processed: documents.length,
      completed,
      failed: documents.length - completed,
      results,
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Batch processing error:', error);
    return c.json({ error: 'Batch processing failed' }, 500);
  }
});

// Scan and queue unprocessed documents
app.post('/queue/scan-unprocessed', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const { limit = 100, source } = body as { limit?: number; source?: string };
    const safeLimit = Math.min(limit, 500);

    // Get unprocessed documents from origin API
    const url = new URL(`${c.env.ORIGIN_URL}/api/documents/unprocessed`);
    url.searchParams.set('limit', safeLimit.toString());
    if (source) url.searchParams.set('source', source);

    const response = await fetch(url.toString(), {
      headers: { 'X-API-Key': c.env.API_SECRET_KEY },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to get unprocessed documents' }, 502);
    }

    const { documents } = await response.json() as { documents: Array<{ documentId: string; r2Key: string; source: string }> };

    if (!documents || documents.length === 0) {
      return c.json({ message: 'No unprocessed documents found', queued: 0 });
    }

    // Queue for processing
    const messages: MessageSendRequest<DocumentMessage>[] = documents.map(doc => ({
      body: {
        type: 'process_document' as const,
        documentId: doc.documentId,
        r2Key: doc.r2Key,
        metadata: { source: doc.source },
        attempt: 1,
      },
    }));

    // Send in batches of 100
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      await c.env.DOCUMENT_QUEUE.sendBatch(batch);
    }

    return c.json({
      success: true,
      queued: documents.length,
      source: source || 'all',
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Scan unprocessed error:', error);
    return c.json({ error: 'Failed to scan and queue' }, 500);
  }
});

// Queue status endpoint
app.get('/queue/status', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Check processing stats from D1
    const stats = await c.env.CACHE_DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM processing_jobs
    `).first();

    return c.json({
      stats: stats || { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Queue status error:', error);
    return c.json({ error: 'Failed to get queue status' }, 500);
  }
});

// Trigger workflow for single document
app.post('/workflow/document', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { documentId, r2Key, source, metadata } = body as {
      documentId: string;
      r2Key: string;
      source: string;
      metadata?: Record<string, unknown>;
    };

    if (!documentId || !r2Key) {
      return c.json({ error: 'documentId and r2Key required' }, 400);
    }

    const instance = await c.env.DOCUMENT_WORKFLOW.create({
      params: { documentId, r2Key, source, metadata },
    });

    return c.json({
      workflowId: instance.id,
      status: 'started',
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Workflow trigger error:', error);
    return c.json({ error: 'Failed to start workflow' }, 500);
  }
});

// Trigger batch workflow for multiple documents
app.post('/workflow/batch', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { documents } = body as {
      documents: Array<{ documentId: string; r2Key: string; source: string }>;
    };

    if (!documents || !Array.isArray(documents)) {
      return c.json({ error: 'documents array required' }, 400);
    }

    const instance = await c.env.BATCH_WORKFLOW.create({
      params: { documents },
    });

    return c.json({
      workflowId: instance.id,
      documentsCount: documents.length,
      status: 'started',
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Batch workflow trigger error:', error);
    return c.json({ error: 'Failed to start batch workflow' }, 500);
  }
});

// Get workflow status
app.get('/workflow/:id', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const workflowId = c.req.param('id');
    const instance = await c.env.DOCUMENT_WORKFLOW.get(workflowId);

    return c.json({
      workflowId,
      status: instance.status,
      output: instance.output,
      requestId: c.get('requestId'),
    });
  } catch (error) {
    console.error('Workflow status error:', error);
    return c.json({ error: 'Failed to get workflow status' }, 500);
  }
});

// List R2 objects for database sync
app.get('/r2/list', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const prefix = c.req.query('prefix') || '';
    const cursor = c.req.query('cursor');
    const limit = Math.min(parseInt(c.req.query('limit') || '1000'), 1000);

    const listed = await c.env.DOCUMENTS.list({
      prefix,
      cursor: cursor || undefined,
      limit,
    });

    const objects = listed.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    }));

    return c.json({
      objects,
      cursor: listed.truncated ? listed.cursor : null,
      truncated: listed.truncated,
      count: objects.length,
    });
  } catch (error) {
    console.error('R2 list error:', error);
    return c.json({ error: 'Failed to list R2 objects' }, 500);
  }
});

// Sync R2 keys with database - updates documents where filename matches
app.post('/r2/sync', async (c) => {
  try {
    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== c.env.API_SECRET_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { r2Keys } = body as { r2Keys: Array<{ key: string; size: number }> };

    if (!r2Keys || !Array.isArray(r2Keys)) {
      return c.json({ error: 'r2Keys array required' }, 400);
    }

    // Send to backend for database update
    const response = await fetch(`${c.env.ORIGIN_URL}/api/documents/sync-r2-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.API_SECRET_KEY,
      },
      body: JSON.stringify({ r2Keys }),
    });

    if (!response.ok) {
      return c.json({ error: 'Backend sync failed' }, 502);
    }

    return response;
  } catch (error) {
    console.error('R2 sync error:', error);
    return c.json({ error: 'Sync failed' }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    path: c.req.path,
    requestId: c.get('requestId'),
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({
    error: 'Internal Server Error',
    requestId: c.get('requestId'),
  }, 500);
});

// Utility function to hash strings for cache keys
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Queue consumer handler
async function processQueueBatch(
  batch: MessageBatch<DocumentMessage>,
  env: Bindings
): Promise<void> {
  // Minimal test: just log and ack all messages
  console.log(`QUEUE CONSUMER INVOKED: ${batch.messages.length} messages`);

  for (const message of batch.messages) {
    try {
      const { type, documentId, r2Key } = message.body;
      console.log(`QUEUE MSG: ${type} - ${documentId?.slice(0, 8)} - ${r2Key?.slice(0, 30)}`);

      // For now, just ack all messages to test if consumer is working
      message.ack();
      continue;

      // Original processing code below (disabled for testing)
      const { text, metadata } = message.body;
      console.log(`[QUEUE] Processing document: ${r2Key}`);

      switch (type) {
        case 'process_document': {
          if (!r2Key) {
            message.ack();
            continue;
          }

          // Get document from R2
          const object = await env.DOCUMENTS.get(r2Key);
          if (!object) {
            console.error(`Document not found in R2: ${r2Key}`);
            message.ack();
            continue;
          }

          // Read PDF content and convert to base64 (chunked for large files)
          const pdfArrayBuffer = await object.arrayBuffer();

          // Skip files larger than 10MB to avoid timeout issues
          if (pdfArrayBuffer.byteLength > 10 * 1024 * 1024) {
            console.log(`Skipping large file (${pdfArrayBuffer.byteLength} bytes): ${r2Key}`);
            message.ack();
            continue;
          }

          const pdfBytes = new Uint8Array(pdfArrayBuffer);
          let pdfBinary = '';
          const chunkSize = 32768;
          for (let i = 0; i < pdfBytes.length; i += chunkSize) {
            const chunk = pdfBytes.subarray(i, i + chunkSize);
            pdfBinary += String.fromCharCode.apply(null, [...chunk]);
          }
          const pdfBase64 = btoa(pdfBinary);

          // Send PDF content to origin for text extraction
          const extractResponse = await fetch(`${env.ORIGIN_URL}/api/extract`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.API_SECRET_KEY,
            },
            body: JSON.stringify({ r2Key, documentId, pdfContent: pdfBase64 }),
          });

          if (!extractResponse.ok) {
            message.retry();
            continue;
          }

          const { text: extractedText } = await extractResponse.json() as { text: string };

          // Queue embedding generation
          await env.DOCUMENT_QUEUE.send({
            type: 'generate_embedding',
            documentId,
            text: extractedText.slice(0, 8000),
            metadata,
          });

          message.ack();
          break;
        }

        case 'generate_embedding': {
          if (!text) {
            message.ack();
            continue;
          }

          // Generate embedding using Workers AI
          const embeddingResponse = await env.AI.run(
            '@cf/baai/bge-base-en-v1.5',
            { text: [text] },
            {
              gateway: {
                id: 'internal-gateway',
                headers: {
                  'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
                },
              },
            }
          ) as { data: number[][] };

          if (!embeddingResponse?.data?.[0]) {
            message.retry();
            continue;
          }

          // Store embedding via origin
          const storeResponse = await fetch(`${env.ORIGIN_URL}/api/embeddings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.API_SECRET_KEY,
            },
            body: JSON.stringify({
              documentId,
              embedding: embeddingResponse.data[0],
              metadata,
            }),
          });

          if (!storeResponse.ok) {
            message.retry();
            continue;
          }

          message.ack();
          break;
        }

        case 'extract_entities': {
          if (!text) {
            message.ack();
            continue;
          }

          // Use Llama for entity extraction
          const entityResponse = await env.AI.run(
            '@cf/meta/llama-3-8b-instruct',
            {
              messages: [
                {
                  role: 'system',
                  content: 'Extract named entities (people, organizations, locations, dates) from the text. Return JSON: {"people":[],"organizations":[],"locations":[],"dates":[]}',
                },
                { role: 'user', content: text.slice(0, 4000) },
              ],
              max_tokens: 1024,
            },
            {
              gateway: {
                id: 'internal-gateway',
                headers: {
                  'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
                },
              },
            }
          ) as { response: string };

          // Store entities via origin
          await fetch(`${env.ORIGIN_URL}/api/entities/batch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.API_SECRET_KEY,
            },
            body: JSON.stringify({
              documentId,
              entities: entityResponse.response,
              metadata,
            }),
          });

          message.ack();
          break;
        }

        default:
          message.ack();
      }
    } catch (error) {
      console.error('Queue processing error:', error);
      message.retry();
    }
  }
}

// Re-export workflow classes
export { DocumentProcessingWorkflow, BatchProcessingWorkflow } from './workflow';

// Export handler with proper types
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<DocumentMessage>, env: Bindings): Promise<void> {
    console.log(`QUEUE HANDLER: Received ${batch.messages.length} messages`);
    for (const message of batch.messages) {
      try {
        console.log(`Processing: ${JSON.stringify(message.body).slice(0, 100)}`);
        message.ack();
      } catch (e) {
        console.error('Message error:', e);
        message.retry();
      }
    }
  },
};
