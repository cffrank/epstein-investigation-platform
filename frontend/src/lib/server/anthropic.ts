import Anthropic from '@anthropic-ai/sdk';

export function createAnthropicClient(platform: App.Platform) {
	const env = platform.env as {
		ANTHROPIC_API_KEY: string;
		CLOUDFLARE_ACCOUNT_ID: string;
	};

	return new Anthropic({
		apiKey: env.ANTHROPIC_API_KEY,
		baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/internal-gateway/anthropic`,
	});
}

// Valid model IDs for user selection
export const CLAUDE_MODELS = {
	'haiku-4.5': 'claude-haiku-4-5-20251001',
	'sonnet-4.6': 'claude-sonnet-4-6',
	'opus-4.6': 'claude-opus-4-6',
} as const;

export type ModelKey = keyof typeof CLAUDE_MODELS;
export const DEFAULT_MODEL: ModelKey = 'sonnet-4.6';
