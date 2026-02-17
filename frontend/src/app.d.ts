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
				API_BASE_URL: string;
				API_SECRET_KEY: string;
				QDRANT_URL: string;
				QDRANT_API_KEY: string;
				QDRANT_COLLECTION: string;
				NEO4J_URL: string;
				NEO4J_USER: string;
				NEO4J_PASSWORD: string;
				OPENAI_API_KEY: string;
			};
		}
	}
}

export {};
