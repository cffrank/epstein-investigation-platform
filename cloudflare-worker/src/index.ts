import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('/*', cors({
  origin: ['https://app.epsteinfiles.org'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/documents/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.DOCUMENTS.get(key);
  
  if (!object) {
    return c.json({ error: 'Document not found' }, 404);
  }
  
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=86400');
  
  return new Response(object.body, { headers });
});

app.post('/search', async (c) => {
  const { query, limit = 10 } = await c.req.json();
  
  const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: query,
  });
  
  const response = await fetch(`${c.env.ORIGIN_URL}/api/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': c.env.API_SECRET_KEY,
    },
    body: JSON.stringify({ vector: embedding.data[0], limit }),
  });
  
  return response;
});

app.get('/entities/:id', async (c) => {
  const id = c.req.param('id');
  
  const response = await fetch(`${c.env.ORIGIN_URL}/api/entities/${id}`, {
    headers: { 'X-API-Key': c.env.API_SECRET_KEY },
  });
  
  return response;
});

app.post('/graph/traverse', async (c) => {
  const body = await c.req.json();
  
  return fetch(`${c.env.ORIGIN_URL}/api/graph/traverse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': c.env.API_SECRET_KEY,
    },
    body: JSON.stringify(body),
  });
});

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

export default app;
