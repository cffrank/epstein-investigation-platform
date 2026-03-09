import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker endpoints", () => {
	it("GET /health returns 200 with status ok", async () => {
		const response = await SELF.fetch("http://localhost/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { status: string };
		expect(body.status).toBe("ok");
	});

	it("POST /search without query returns 400", async () => {
		const response = await SELF.fetch("http://localhost/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe("Query string required");
	});

	it("POST /process/batch without X-API-Key returns 401", async () => {
		const response = await SELF.fetch("http://localhost/process/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ limit: 10 }),
		});
		expect(response.status).toBe(401);
	});

	it("GET /documents/nonexistent returns 404", async () => {
		const response = await SELF.fetch("http://localhost/documents/nonexistent-key.pdf");
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe("Document not found");
	});

	it("GET /nonexistent-route returns 404", async () => {
		const response = await SELF.fetch("http://localhost/does-not-exist");
		expect(response.status).toBe(404);
	});
});
