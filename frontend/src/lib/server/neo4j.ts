interface Neo4jResult {
	columns: string[];
	data: Array<{ row: unknown[]; meta: unknown[] }>;
}

interface Neo4jResponse {
	results: Neo4jResult[];
	errors: Array<{ code: string; message: string }>;
}

export function neo4jClient(platform: App.Platform) {
	const env = platform.env as { API_BASE_URL: string; API_SECRET_KEY: string };
	const baseUrl = env.API_BASE_URL;
	const apiKey = env.API_SECRET_KEY;

	return {
		async query(
			cypher: string,
			params: Record<string, unknown> = {}
		): Promise<{ columns: string[]; rows: unknown[][] }> {
			const response = await fetch(`${baseUrl}/mcp/neo4j/db/neo4j/tx/commit`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': apiKey,
					Accept: 'application/json'
				},
				body: JSON.stringify({
					statements: [{ statement: cypher, parameters: params }]
				})
			});

			if (!response.ok) {
				throw new Error(`Neo4j query failed: ${response.status} ${await response.text()}`);
			}

			const data = (await response.json()) as Neo4jResponse;

			if (data.errors.length > 0) {
				throw new Error(`Neo4j error: ${data.errors[0].message}`);
			}

			const result = data.results[0];
			return {
				columns: result.columns,
				rows: result.data.map((d) => d.row)
			};
		}
	};
}
