import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { cache } from 'hono/cache';

// Cloudflare bindings type
type Bindings = {
  DOCUMENTS: R2Bucket;
  CACHE_DB: D1Database;
  SESSIONS: KVNamespace;
  AI: Ai;
  API_SECRET_KEY: string;
  AI_GATEWAY_TOKEN: string;
  ORIGIN_URL: string;
  ENVIRONMENT: string;
};

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

export default app;
