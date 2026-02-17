import { error } from '@sveltejs/kit';
import { queryOne } from '$lib/server/db';
import { neo4jClient } from '$lib/server/neo4j';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	if (!platform?.env) {
		return {
			document: null,
			entities: [],
			error: 'Platform not available'
		};
	}

	try {
		const doc = await queryOne<{
			id: string;
			filename: string;
			source: string;
			doc_type: string | null;
			file_size_bytes: number | null;
			r2_key: string | null;
			text: string | null;
			extracted_text: string | null;
			page_count: string | null;
			created_at: string;
			content_hash: string | null;
		}>(
			platform,
			`SELECT
				id, filename, source, doc_type, file_size_bytes, r2_key,
				LEFT(metadata->>'text', 50000) as text,
				LEFT(metadata->>'extracted_text', 50000) as extracted_text,
				metadata->>'page_count' as page_count,
				content_hash,
				created_at
			FROM documents WHERE id = $1`,
			[params.id]
		);

		if (!doc) {
			error(404, { message: 'Document not found' });
		}

		let entities: Array<{ id: string; name: string; type: string }> = [];
		try {
			const neo4j = neo4jClient(platform);
			const entityResult = await neo4j.query(
				`MATCH (d:Document {doc_id: $docId})-[:MENTIONS]->(e)
				 RETURN id(e) as id, e.name as name, labels(e)[0] as type
				 LIMIT 100`,
				{ docId: params.id }
			);
			entities = entityResult.rows.map((row) => ({
				id: String(row[0]),
				name: String(row[1]),
				type: String(row[2])
			}));
		} catch (e) {
			console.error('Neo4j entity fetch failed:', e);
		}

		return {
			document: {
				id: doc.id,
				filename: doc.filename,
				source: doc.source,
				doc_type: doc.doc_type,
				file_size_bytes: doc.file_size_bytes,
				r2_key: doc.r2_key,
				text: doc.text || doc.extracted_text || null,
				page_count: doc.page_count ? parseInt(doc.page_count, 10) : null,
				content_hash: doc.content_hash,
				created_at: doc.created_at
			},
			entities
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit errors
		console.error('Document page load error:', e);
		error(500, { message: String(e) });
	}
};
