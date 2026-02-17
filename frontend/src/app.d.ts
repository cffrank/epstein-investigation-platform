/// <reference types="@sveltejs/adapter-cloudflare" />

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
		}

		interface Locals {
			user?: {
				email: string;
				name?: string;
			};
		}

		interface Platform {
			env: {
				HYPERDRIVE: Hyperdrive;
				QDRANT_URL: string;
				QDRANT_API_KEY: string;
				QDRANT_COLLECTION: string;
				NEO4J_URL: string;
				NEO4J_USER: string;
				NEO4J_PASSWORD: string;
				OPENAI_API_KEY: string;
				R2_BUCKET_URL: string;
				R2_ACCESS_KEY_ID: string;
				R2_SECRET_ACCESS_KEY: string;
				CF_ACCESS_TEAM: string;
			};
		}
	}

	interface Hyperdrive {
		connectionString: string;
	}
}

export {};
