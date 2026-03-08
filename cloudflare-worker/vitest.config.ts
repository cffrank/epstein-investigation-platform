import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.toml' },
				miniflare: {
					bindings: {
						API_SECRET_KEY: 'test-secret-key-for-vitest',
					},
				},
			},
		},
	},
});
