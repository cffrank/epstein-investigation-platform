import { query } from "$lib/server/db";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, platform }) => {
	if (!platform?.env) {
		return json({ error: "Platform unavailable" }, { status: 500 });
	}

	const { id } = params;
	if (!id || !/^\d+$/.test(id)) {
		return json({ error: "Invalid entity ID" }, { status: 400 });
	}

	const notes = await query(
		platform,
		"SELECT id, entity_id, content, created_at, updated_at FROM entity_notes WHERE entity_id = $1 ORDER BY created_at DESC",
		[id],
	);
	return json(notes);
};

export const POST: RequestHandler = async ({ params, request, platform }) => {
	if (!platform?.env) {
		return json({ error: "Platform unavailable" }, { status: 500 });
	}

	const { id } = params;
	if (!id || !/^\d+$/.test(id)) {
		return json({ error: "Invalid entity ID" }, { status: 400 });
	}

	const body = (await request.json()) as { content?: string };
	const content = body.content?.trim();
	if (!content) {
		return json({ error: "Content is required" }, { status: 400 });
	}
	if (content.length > 10000) {
		return json({ error: "Content too long (max 10000 chars)" }, { status: 400 });
	}

	const notes = await query(
		platform,
		"INSERT INTO entity_notes (entity_id, content) VALUES ($1, $2) RETURNING id, entity_id, content, created_at, updated_at",
		[id, content],
	);
	return json(notes[0], { status: 201 });
};

export const PUT: RequestHandler = async ({ params, request, platform }) => {
	if (!platform?.env) {
		return json({ error: "Platform unavailable" }, { status: 500 });
	}

	const { id } = params;
	if (!id || !/^\d+$/.test(id)) {
		return json({ error: "Invalid entity ID" }, { status: 400 });
	}

	const body = (await request.json()) as { note_id?: string; content?: string };
	const { note_id } = body;
	if (!note_id) {
		return json({ error: "note_id is required" }, { status: 400 });
	}
	const trimmed = body.content?.trim();
	if (!trimmed) {
		return json({ error: "Content is required" }, { status: 400 });
	}
	if (trimmed.length > 10000) {
		return json({ error: "Content too long" }, { status: 400 });
	}

	const notes = await query(
		platform,
		"UPDATE entity_notes SET content = $1, updated_at = NOW() WHERE id = $2 AND entity_id = $3 RETURNING id, entity_id, content, created_at, updated_at",
		[trimmed, note_id, id],
	);
	if (notes.length === 0) {
		return json({ error: "Note not found" }, { status: 404 });
	}
	return json(notes[0]);
};

export const DELETE: RequestHandler = async ({ params, request, platform }) => {
	if (!platform?.env) {
		return json({ error: "Platform unavailable" }, { status: 500 });
	}

	const { id } = params;
	if (!id || !/^\d+$/.test(id)) {
		return json({ error: "Invalid entity ID" }, { status: 400 });
	}

	const body = (await request.json()) as { note_id?: string };
	const { note_id } = body;
	if (!note_id) {
		return json({ error: "note_id is required" }, { status: 400 });
	}

	const result = await query(
		platform,
		"DELETE FROM entity_notes WHERE id = $1 AND entity_id = $2 RETURNING id",
		[note_id, id],
	);
	if (result.length === 0) {
		return json({ error: "Note not found" }, { status: 404 });
	}
	return json({ deleted: true });
};
