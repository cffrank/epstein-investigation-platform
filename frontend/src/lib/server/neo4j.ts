interface Neo4jResult {
	columns: string[];
	data: Array<{ row: unknown[]; meta: unknown[] }>;
}

interface Neo4jResponse {
	results: Neo4jResult[];
	errors: Array<{ code: string; message: string }>;
}

export function neo4jClient(platform: App.Platform) {
	const baseUrl = platform.env.NEO4J_URL;
	const user = platform.env.NEO4J_USER;
	const password = platform.env.NEO4J_PASSWORD;

	const auth = btoa(`${user}:${password}`);

	return {
		async query(
			cypher: string,
			params: Record<string, unknown> = {}
		): Promise<{ columns: string[]; rows: unknown[][] }> {
			const response = await fetch(`${baseUrl}/db/neo4j/tx/commit`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Basic ${auth}`,
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
