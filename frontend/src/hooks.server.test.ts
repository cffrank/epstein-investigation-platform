import { describe, it, expect } from 'vitest';
import { handle } from './hooks.server';

function createMockEvent(path: string, headers: Record<string, string> = {}) {
	const url = new URL(`http://localhost${path}`);
	const request = new Request(url, {
		headers: new Headers(headers)
	});
	return {
		url,
		request,
		locals: {} as Record<string, unknown>,
		route: { id: path },
		isDataRequest: false,
		isSubRequest: false,
		cookies: {} as never,
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		platform: {} as never,
		params: {},
		setHeaders: () => {}
	};
}

function createMockResolve() {
	return async () => new Response('OK', { status: 200 });
}

describe('hooks.server handle', () => {
	it('returns 401 for /api/ requests without auth header', async () => {
		const event = createMockEvent('/api/search');
		const response = await handle({
			event: event as never,
			resolve: createMockResolve()
		});
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBe('Unauthorized');
	});

	it('allows /api/ requests with Cf-Access-Authenticated-User-Email header', async () => {
		const event = createMockEvent('/api/search', {
			'Cf-Access-Authenticated-User-Email': 'user@example.com'
		});
		const response = await handle({
			event: event as never,
			resolve: createMockResolve()
		});
		expect(response.status).toBe(200);
	});

	it('sets event.locals.user when auth header present', async () => {
		const event = createMockEvent('/api/search', {
			'Cf-Access-Authenticated-User-Email': 'user@example.com'
		});
		await handle({
			event: event as never,
			resolve: createMockResolve()
		});
		expect(event.locals.user).toEqual({ email: 'user@example.com' });
	});

	it('allows non-API paths without auth', async () => {
		const event = createMockEvent('/dashboard');
		const response = await handle({
			event: event as never,
			resolve: createMockResolve()
		});
		expect(response.status).toBe(200);
	});

	it('allows /api/health without auth', async () => {
		const event = createMockEvent('/api/health');
		const response = await handle({
			event: event as never,
			resolve: createMockResolve()
		});
		expect(response.status).toBe(200);
	});
});
