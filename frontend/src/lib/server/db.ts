interface QueryResponse<T> {
	rows: T[];
	rowCount: number;
	error?: string;
}

export async function query<T = Record<string, unknown>>(
	platform: App.Platform,
	sql: string,
	params?: unknown[]
): Promise<T[]> {
	const env = platform.env as { API_BASE_URL: string; API_SECRET_KEY: string };
	const baseUrl = env.API_BASE_URL;
	const apiKey = env.API_SECRET_KEY;

	const response = await fetch(`${baseUrl}/mcp/query`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-API-Key': apiKey
		},
		body: JSON.stringify({ sql, params: params || [] })
	});

	if (!response.ok) {
		const err = await response.json().catch(() => ({ error: response.statusText }));
		throw new Error((err as { error: string }).error || `DB query failed: ${response.status}`);
	}

	const data = (await response.json()) as QueryResponse<T>;
	if (data.error) throw new Error(data.error);
	return data.rows;
}

export async function queryOne<T = Record<string, unknown>>(
	platform: App.Platform,
	sql: string,
	params?: unknown[]
): Promise<T | null> {
	const rows = await query<T>(platform, sql, params);
	return rows[0] ?? null;
}
