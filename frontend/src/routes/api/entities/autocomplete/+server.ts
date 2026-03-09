import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query as dbQuery } from '$lib/server/db';
import type { EntityRef, EntityType } from '$lib/types';
import { validateSearchQuery } from '@epstein/shared';

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
	person: 'Person',
	organization: 'Organization',
	location: 'Location'
};

export const GET: RequestHandler = async ({ url, platform }) => {
	if (!platform?.env) {
		return json({ error: 'Platform unavailable in dev mode' }, { status: 500 });
	}

	const q = url.searchParams.get('q')?.trim();

	if (!q) {
		return json([]);
	}

	// Sanitize input -- reuse existing validation (strips dangerous chars)
	const sanitized = validateSearchQuery(q);

	try {
		const rows = await dbQuery<{
			id: string;
			name: string;
			type: string;
		}>(
			platform,
			`SELECT id, canonical_name as name, entity_type as type
			FROM entities
			WHERE canonical_name ILIKE $1 || '%'
			ORDER BY canonical_name
			LIMIT 10`,
			[sanitized]
		);

		const results: EntityRef[] = rows.map((row) => ({
			id: row.id,
			name: row.name,
			type: ENTITY_TYPE_MAP[row.type.toLowerCase()] ?? 'Person'
		}));

		return json(results);
	} catch (error) {
		console.error('Entity autocomplete error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
