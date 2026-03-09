import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRequireApiKey, createRequireAuth } from "./guards.js";

describe("createRequireApiKey", () => {
	it("throws if apiSecretKey is empty (fail-closed)", () => {
		expect(() => createRequireApiKey("")).toThrow();
	});

	it("throws if apiSecretKey is undefined/falsy (fail-closed)", () => {
		// biome-ignore lint: testing falsy behavior
		expect(() => createRequireApiKey(undefined as any)).toThrow();
	});

	it("rejects requests without matching X-API-Key", async () => {
		const app = new Hono();
		app.use("*", createRequireApiKey("my-secret"));
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test");
		expect(res.status).toBe(401);
	});

	it("rejects requests with wrong X-API-Key", async () => {
		const app = new Hono();
		app.use("*", createRequireApiKey("my-secret"));
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test", {
			headers: { "X-API-Key": "wrong-key" },
		});
		expect(res.status).toBe(401);
	});

	it("allows requests with correct X-API-Key", async () => {
		const app = new Hono();
		app.use("*", createRequireApiKey("my-secret"));
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test", {
			headers: { "X-API-Key": "my-secret" },
		});
		expect(res.status).toBe(200);
	});
});

describe("createRequireAuth", () => {
	it("rejects when Cf-Access-Authenticated-User-Email header is missing", async () => {
		const app = new Hono();
		app.use("*", createRequireAuth());
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test");
		expect(res.status).toBe(401);
	});

	it("rejects when header is empty string", async () => {
		const app = new Hono();
		app.use("*", createRequireAuth());
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test", {
			headers: { "Cf-Access-Authenticated-User-Email": "" },
		});
		expect(res.status).toBe(401);
	});

	it("allows requests with valid auth header", async () => {
		const app = new Hono();
		app.use("*", createRequireAuth());
		app.get("/test", (c) => c.json({ ok: true }));

		const res = await app.request("/test", {
			headers: { "Cf-Access-Authenticated-User-Email": "user@example.com" },
		});
		expect(res.status).toBe(200);
	});
});
