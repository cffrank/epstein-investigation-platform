#!/usr/bin/env node
// Fast parallel document processor - runs directly on server
// Bypasses Cloudflare Worker for most operations, uses Workers AI only for embeddings

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { QdrantClient } from "@qdrant/js-client-rest";
import pdf from "pdf-parse/lib/pdf-parse.js";
import pg from "pg";

const { Pool } = pg;

// Configuration
const BATCH_SIZE = 200; // Documents per batch
const CONCURRENT_DOCS = 20; // Parallel document processing
const EMBEDDING_BATCH = 10; // Embeddings per AI request

// R2 client
const r2Client = new S3Client({
	region: "auto",
	endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
	},
});

const R2_BUCKET = process.env.R2_BUCKET || "epstein-documents";

// PostgreSQL
const pool = new Pool({
	host: process.env.PG_HOST || "postgres",
	port: Number.parseInt(process.env.PG_PORT || "5432"),
	database: process.env.PG_DATABASE || "epstein",
	user: process.env.PG_USER || "postgres",
	password: process.env.PG_PASSWORD,
	max: 30,
});

// Qdrant
const qdrant = new QdrantClient({
	host: process.env.QDRANT_HOST || "qdrant",
	port: Number.parseInt(process.env.QDRANT_PORT || "6333"),
	apiKey: process.env.QDRANT_API_KEY,
});

// Workers AI endpoint
const WORKER_URL = process.env.WORKER_URL || "https://epstein-api.carl-f-frank.workers.dev";
const API_KEY = process.env.API_SECRET_KEY || "";

// Claim documents atomically
async function claimDocuments(limit) {
	const result = await pool.query(
		`
    UPDATE documents
    SET embedding_status = 'processing',
        updated_at = NOW()
    WHERE id IN (
      SELECT id FROM documents
      WHERE embedding_status = 'pending'
        AND r2_key IS NOT NULL
        AND (r2_key LIKE 'dataset_9/%' OR r2_key LIKE 'dataset_10/%' OR r2_key LIKE 'dataset_11/%')
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, r2_key, filename
  `,
		[limit],
	);

	return result.rows;
}

// Extract text from PDF
async function extractText(r2Key) {
	try {
		const obj = await r2Client.send(
			new GetObjectCommand({
				Bucket: R2_BUCKET,
				Key: r2Key,
			}),
		);

		const chunks = [];
		for await (const chunk of obj.Body) {
			chunks.push(chunk);
		}
		const buffer = Buffer.concat(chunks);

		// Check file size - skip very large files
		if (buffer.length > 50 * 1024 * 1024) {
			return { text: "", needsOcr: false, tooLarge: true };
		}

		const data = await pdf(buffer);
		const text = data.text?.trim() || "";

		// If less than 50 chars, likely needs OCR
		if (text.length < 50) {
			return { text: "", needsOcr: true, tooLarge: false };
		}

		return { text: text.slice(0, 50000), needsOcr: false, tooLarge: false };
	} catch (err) {
		console.error(`Extract error for ${r2Key}:`, err.message);
		return { text: "", needsOcr: false, error: true };
	}
}

// Generate embeddings via Workers AI (batched)
async function generateEmbeddings(texts) {
	try {
		const response = await fetch(`${WORKER_URL}/ai/embeddings-batch`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": API_KEY,
			},
			body: JSON.stringify({ texts: texts.map((t) => t.slice(0, 8000)) }),
		});

		if (!response.ok) {
			// Fall back to individual requests
			const embeddings = [];
			for (const text of texts) {
				const single = await fetch(`${WORKER_URL}/ai/embedding`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-API-Key": API_KEY,
					},
					body: JSON.stringify({ text: text.slice(0, 8000) }),
				});
				const data = await single.json();
				embeddings.push(data.embedding || null);
			}
			return embeddings;
		}

		const data = await response.json();
		return data.embeddings || [];
	} catch (err) {
		console.error("Embedding error:", err.message);
		return texts.map(() => null);
	}
}

// Store embedding in Qdrant
async function storeEmbedding(docId, embedding, filename) {
	try {
		await qdrant.upsert("documents", {
			wait: false,
			points: [
				{
					id: docId,
					vector: embedding,
					payload: { filename, document_id: docId },
				},
			],
		});
		return true;
	} catch (err) {
		console.error(`Qdrant error for ${docId}:`, err.message);
		return false;
	}
}

// Update document status
async function updateStatus(docId, status, metadata = null) {
	try {
		if (metadata) {
			await pool.query(
				`
        UPDATE documents
        SET embedding_status = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
        WHERE id = $3
      `,
				[status, JSON.stringify(metadata), docId],
			);
		} else {
			await pool.query(
				`
        UPDATE documents
        SET embedding_status = $1, updated_at = NOW()
        WHERE id = $2
      `,
				[status, docId],
			);
		}
	} catch (err) {
		console.error(`Status update error for ${docId}:`, err.message);
	}
}

// Process a single document
async function processDocument(doc) {
	const { id, r2_key, filename } = doc;

	// Extract text
	const { text, needsOcr, tooLarge, error } = await extractText(r2_key);

	if (tooLarge) {
		await updateStatus(id, "failed", { error: "too_large" });
		return { status: "too_large" };
	}

	if (needsOcr) {
		await updateStatus(id, "needs_ocr");
		return { status: "needs_ocr" };
	}

	if (error || !text) {
		await updateStatus(id, "failed", { error: "extract_failed" });
		return { status: "failed" };
	}

	// Store extracted text
	await updateStatus(id, "processing", { extracted_text: text.slice(0, 10000) });

	return { status: "extracted", id, text, filename };
}

// Process batch with parallelism
async function processBatch() {
	console.log(`\nClaiming ${BATCH_SIZE} documents...`);
	const docs = await claimDocuments(BATCH_SIZE);

	if (docs.length === 0) {
		return { processed: 0, completed: 0, failed: 0 };
	}

	console.log(`Claimed ${docs.length} documents`);

	let completed = 0;
	let failed = 0;
	let needsOcr = 0;

	// Process documents in parallel chunks
	const extracted = [];

	for (let i = 0; i < docs.length; i += CONCURRENT_DOCS) {
		const chunk = docs.slice(i, i + CONCURRENT_DOCS);
		const results = await Promise.all(chunk.map(processDocument));

		for (const result of results) {
			if (result.status === "extracted") {
				extracted.push(result);
			} else if (result.status === "needs_ocr") {
				needsOcr++;
			} else {
				failed++;
			}
		}
	}

	console.log(`Extracted ${extracted.length} documents, generating embeddings...`);

	// Generate embeddings in batches
	for (let i = 0; i < extracted.length; i += EMBEDDING_BATCH) {
		const batch = extracted.slice(i, i + EMBEDDING_BATCH);
		const texts = batch.map((d) => d.text);

		const embeddings = await generateEmbeddings(texts);

		// Store embeddings and update status
		for (let j = 0; j < batch.length; j++) {
			const doc = batch[j];
			const embedding = embeddings[j];

			if (embedding && embedding.length > 0) {
				const stored = await storeEmbedding(doc.id, embedding, doc.filename);
				if (stored) {
					await updateStatus(doc.id, "completed");
					completed++;
				} else {
					await updateStatus(doc.id, "failed", { error: "qdrant_error" });
					failed++;
				}
			} else {
				await updateStatus(doc.id, "failed", { error: "embedding_failed" });
				failed++;
			}
		}
	}

	return { processed: docs.length, completed, failed, needsOcr };
}

// Get current stats
async function getStats() {
	const result = await pool.query(`
    SELECT embedding_status, COUNT(*) as count
    FROM documents
    WHERE r2_key IS NOT NULL
    GROUP BY embedding_status
  `);
	return result.rows.reduce((acc, row) => {
		acc[row.embedding_status] = Number.parseInt(row.count);
		return acc;
	}, {});
}

// Main loop
async function main() {
	console.log("=== Fast Document Processor ===");
	console.log(`Batch size: ${BATCH_SIZE}`);
	console.log(`Concurrent docs: ${CONCURRENT_DOCS}`);
	console.log(`Embedding batch: ${EMBEDDING_BATCH}`);
	console.log("");

	const startTime = Date.now();
	let totalProcessed = 0;
	let totalCompleted = 0;
	let batchNum = 0;

	while (true) {
		batchNum++;
		const { processed, completed, failed, needsOcr } = await processBatch();

		if (processed === 0) {
			console.log("No more documents to process");
			break;
		}

		totalProcessed += processed;
		totalCompleted += completed;

		const elapsed = (Date.now() - startTime) / 1000 / 60;
		const rate = totalCompleted / elapsed;

		console.log(`Batch ${batchNum}: ${completed} completed, ${failed} failed, ${needsOcr} OCR`);
		console.log(`Total: ${totalCompleted} completed (${rate.toFixed(1)}/min)`);

		// Brief pause
		await new Promise((r) => setTimeout(r, 500));
	}

	const stats = await getStats();
	console.log("\n=== Final Stats ===");
	console.log(stats);

	await pool.end();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
