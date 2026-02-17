import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// CF Access JWT assertion is passed through by Cloudflare
	const email = event.request.headers.get('Cf-Access-Authenticated-User-Email');
	if (email) {
		event.locals.user = { email };
	}

	return resolve(event);
};
