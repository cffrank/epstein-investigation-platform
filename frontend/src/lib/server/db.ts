import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(platform: App.Platform): pg.Pool {
	if (!pool) {
		pool = new Pool({
			connectionString: platform.env.HYPERDRIVE.connectionString,
			max: 5
		});
	}
	return pool;
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
	platform: App.Platform,
	sql: string,
	params?: unknown[]
): Promise<T[]> {
	const p = getPool(platform);
	const result = await p.query<T>(sql, params);
	return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = Record<string, unknown>>(
	platform: App.Platform,
	sql: string,
	params?: unknown[]
): Promise<T | null> {
	const rows = await query<T>(platform, sql, params);
	return rows[0] ?? null;
}
