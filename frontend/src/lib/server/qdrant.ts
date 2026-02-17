interface QdrantSearchResult {
	id: string | number;
	score: number;
	payload: Record<string, unknown>;
}

interface QdrantSearchResponse {
	result: QdrantSearchResult[];
	status: string;
	time: number;
}

export function qdrantClient(platform: App.Platform) {
	const baseUrl = platform.env.API_BASE_URL;
	const apiKey = platform.env.API_SECRET_KEY;
	const collection = platform.env.QDRANT_COLLECTION;

	return {
		async search(
			vector: number[],
			options: { limit?: number; filter?: Record<string, unknown>; with_payload?: boolean }
		): Promise<QdrantSearchResult[]> {
			const response = await fetch(
				`${baseUrl}/mcp/qdrant/collections/${collection}/points/search`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-API-Key': apiKey
					},
					body: JSON.stringify({
						vector,
						limit: options.limit ?? 10,
						filter: options.filter,
						with_payload: options.with_payload ?? true
					})
				}
			);

			if (!response.ok) {
				throw new Error(`Qdrant search failed: ${response.status} ${await response.text()}`);
			}

			const data = (await response.json()) as QdrantSearchResponse;
			return data.result;
		},

		async getCollectionInfo() {
			const response = await fetch(`${baseUrl}/mcp/qdrant/collections/${collection}`, {
				headers: { 'X-API-Key': apiKey }
			});
			if (!response.ok) {
				throw new Error(`Qdrant collection info failed: ${response.status}`);
			}
			return response.json();
		}
	};
}
