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
				QDRANT_COLLECTION: string;
				OPENAI_API_KEY: string;
				ANTHROPIC_API_KEY: string;
				CLOUDFLARE_ACCOUNT_ID: string;
			};
		}
	}
}

export {};
