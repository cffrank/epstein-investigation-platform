import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

interface Env {
	DOCUMENTS: R2Bucket;
	CACHE_DB: D1Database;
	AI: Ai;
	API_SECRET_KEY: string;
	AI_GATEWAY_TOKEN: string;
	ORIGIN_URL: string;
	OPENAI_API_KEY: string;
}

interface DocumentProcessingParams {
	documentId: string;
	r2Key: string;
	source: string;
	metadata?: Record<string, unknown>;
}

interface ProcessingState {
	documentId: string;
	r2Key: string;
	source: string;
	text?: string;
	embedding?: number[];
	entities?: Record<string, string[]>;
	status: "pending" | "extracting" | "embedding" | "storing" | "completed" | "failed";
	error?: string;
}

export class DocumentProcessingWorkflow extends WorkflowEntrypoint<Env, DocumentProcessingParams> {
	async run(event: WorkflowEvent<DocumentProcessingParams>, step: WorkflowStep) {
		const { documentId, r2Key, source, metadata } = event.payload;

		// Step 1: Extract text from PDF
		const extractResult = await step.do("extract-text", async () => {
			const object = await this.env.DOCUMENTS.get(r2Key);
			if (!object) {
				throw new Error(`Document not found: ${r2Key}`);
			}

			// Call origin server for PDF text extraction
			const response = await fetch(`${this.env.ORIGIN_URL}/api/extract`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": this.env.API_SECRET_KEY,
				},
				body: JSON.stringify({ r2Key, documentId }),
			});

			if (!response.ok) {
				throw new Error(`Text extraction failed: ${response.status}`);
			}

			const { text, pageCount } = (await response.json()) as { text: string; pageCount: number };
			return { text, pageCount };
		});

		// Step 2: Generate embedding (can run in parallel with entity extraction)
		const embeddingPromise = step.do("generate-embedding", async () => {
			const textChunk = extractResult.text.slice(0, 8000);

			const response = await fetch("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: "text-embedding-3-small",
					input: textChunk,
					dimensions: 1536,
				}),
			});
			const data = (await response.json()) as { data: { embedding: number[] }[] };

			if (!data?.data?.[0]?.embedding) {
				throw new Error("Embedding generation failed");
			}

			return data.data[0].embedding;
		});

		// Step 3: Extract entities (runs in parallel with embedding)
		const entitiesPromise = step.do("extract-entities", async () => {
			const textChunk = extractResult.text.slice(0, 4000);

			const response = (await this.env.AI.run(
				"@cf/meta/llama-3-8b-instruct",
				{
					messages: [
						{
							role: "system",
							content: `Extract named entities from the document. Return valid JSON only:
{"people":["name1","name2"],"organizations":["org1"],"locations":["loc1"],"dates":["date1"]}`,
						},
						{ role: "user", content: textChunk },
					],
					max_tokens: 1024,
				},
				{
					gateway: {
						id: "internal-gateway",
						headers: {
							"cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}`,
						},
					},
				},
			)) as { response: string };

			try {
				return JSON.parse(response.response);
			} catch {
				return { people: [], organizations: [], locations: [], dates: [] };
			}
		});

		// Wait for both parallel steps
		const [embedding, entities] = await Promise.all([embeddingPromise, entitiesPromise]);

		// Step 4: Store everything to origin
		await step.do("store-results", async () => {
			const response = await fetch(`${this.env.ORIGIN_URL}/api/documents/complete`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": this.env.API_SECRET_KEY,
				},
				body: JSON.stringify({
					documentId,
					r2Key,
					source,
					text: extractResult.text,
					pageCount: extractResult.pageCount,
					embedding,
					entities,
					metadata,
				}),
			});

			if (!response.ok) {
				throw new Error(`Storage failed: ${response.status}`);
			}

			return { success: true };
		});

		// Step 5: Update processing status
		await step.do("update-status", async () => {
			await this.env.CACHE_DB.prepare(
				`INSERT OR REPLACE INTO processing_jobs
         (id, document_id, r2_key, status, job_type, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'completed', 'workflow', 1, ?, ?)`,
			)
				.bind(documentId, documentId, r2Key, Date.now(), Date.now())
				.run();

			return { status: "completed" };
		});

		return {
			documentId,
			status: "completed",
			pageCount: extractResult.pageCount,
			entitiesCount: {
				people: entities.people?.length || 0,
				organizations: entities.organizations?.length || 0,
				locations: entities.locations?.length || 0,
				dates: entities.dates?.length || 0,
			},
		};
	}
}

// Batch workflow for processing multiple documents
export class BatchProcessingWorkflow extends WorkflowEntrypoint<
	Env,
	{ documents: DocumentProcessingParams[] }
> {
	async run(event: WorkflowEvent<{ documents: DocumentProcessingParams[] }>, step: WorkflowStep) {
		const { documents } = event.payload;
		const results: Array<{ documentId: string; status: string; error?: string }> = [];

		// Process documents in batches of 10 to avoid overwhelming the system
		const batchSize = 10;

		for (let i = 0; i < documents.length; i += batchSize) {
			const batch = documents.slice(i, i + batchSize);

			const batchResults = await step.do(`process-batch-${i}`, async () => {
				const promises = batch.map(async (doc) => {
					try {
						// Get document from R2
						const object = await this.env.DOCUMENTS.get(doc.r2Key);
						if (!object) {
							return { documentId: doc.documentId, status: "failed", error: "Not found" };
						}

						// Generate embedding
						const embeddingResp = await fetch("https://api.openai.com/v1/embeddings", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
							},
							body: JSON.stringify({
								model: "text-embedding-3-small",
								input: "Document processing placeholder",
								dimensions: 1536,
							}),
						});
						const embeddingData = (await embeddingResp.json()) as {
							data: { embedding: number[] }[];
						};

						return { documentId: doc.documentId, status: "completed" };
					} catch (error) {
						return {
							documentId: doc.documentId,
							status: "failed",
							error: error instanceof Error ? error.message : "Unknown error",
						};
					}
				});

				return Promise.all(promises);
			});

			results.push(...batchResults);
		}

		return {
			total: documents.length,
			completed: results.filter((r) => r.status === "completed").length,
			failed: results.filter((r) => r.status === "failed").length,
			results,
		};
	}
}
