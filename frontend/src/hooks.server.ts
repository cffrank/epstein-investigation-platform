import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Enforce auth on all /api/ routes (fail-closed: missing header = blocked)
	if (pathname.startsWith('/api/') && pathname !== '/api/health') {
		const email = event.request.headers.get('Cf-Access-Authenticated-User-Email');
		if (!email) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		event.locals.user = { email };
	} else {
		// For non-API routes, still set user if available
		const email = event.request.headers.get('Cf-Access-Authenticated-User-Email');
		if (email) {
			event.locals.user = { email };
		}
	}

	return resolve(event);
};
