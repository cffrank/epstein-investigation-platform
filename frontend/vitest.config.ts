import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
	resolve: {
		alias: {
			$lib: path.resolve("./src/lib"),
			$app: path.resolve("./src/app-mocks"),
		},
	},
});
