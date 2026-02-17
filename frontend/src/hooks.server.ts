import type { Handle } from '@sveltejs/kit';
import { validateCFAccessJWT } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const team = event.platform?.env?.CF_ACCESS_TEAM;

	// Skip auth validation in dev mode or if no team configured
	if (!team) {
		return resolve(event);
	}

	const token = event.request.headers.get('Cf-Access-Jwt-Assertion');

	if (token) {
		const payload = await validateCFAccessJWT(token, team);
		if (payload) {
			event.locals.user = {
				email: payload.email,
				name: payload.name
			};
		}
	}

	return resolve(event);
};
