import type { MiddlewareHandler } from "hono";

/**
 * Create Hono middleware that requires a matching X-API-Key header.
 * Fail-closed: throws if apiSecretKey is empty/falsy (refuses to create guard with no key).
 */
export function createRequireApiKey(apiSecretKey: string): MiddlewareHandler {
	if (!apiSecretKey) {
		throw new Error(
			"API secret key must be provided. Refusing to create auth guard with empty key (fail-closed).",
		);
	}

	return async (c, next) => {
		const apiKey = c.req.header("X-API-Key");
		if (!apiKey || apiKey !== apiSecretKey) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		await next();
	};
}

/**
 * Create Hono middleware that requires Cloudflare Access authentication.
 * Checks for Cf-Access-Authenticated-User-Email header.
 * Returns 401 if missing or empty.
 */
export function createRequireAuth(): MiddlewareHandler {
	return async (c, next) => {
		const email = c.req.header("Cf-Access-Authenticated-User-Email");
		if (!email) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		await next();
	};
}
