import { describe, it, expect } from "vitest";
import {
	buildFulltextSearchQuery,
	buildCappedCountQuery,
	buildDocumentStatsQuery,
	buildEntityListQuery,
} from "./sql.js";

describe("buildFulltextSearchQuery", () => {
	it("returns parameterized SQL using plainto_tsquery, never ILIKE", () => {
		const result = buildFulltextSearchQuery("test query");
		expect(result.text).toContain("plainto_tsquery");
		expect(result.text).not.toContain("ILIKE");
		expect(result.values).toContain("test query");
	});

	it("throws on empty string", () => {
		expect(() => buildFulltextSearchQuery("")).toThrow();
	});

	it("throws on whitespace-only string", () => {
		expect(() => buildFulltextSearchQuery("   ")).toThrow();
	});

	it("applies limit and offset", () => {
		const result = buildFulltextSearchQuery("test", { limit: 20, offset: 40 });
		expect(result.text).toContain("LIMIT");
		expect(result.text).toContain("OFFSET");
		expect(result.values).toContain(20);
		expect(result.values).toContain(40);
	});

	it("applies source filter when provided", () => {
		const result = buildFulltextSearchQuery("test", { source: "dataset_9" });
		expect(result.text).toContain("source");
		expect(result.values).toContain("dataset_9");
	});

	it("uses default limit of 25 and offset of 0", () => {
		const result = buildFulltextSearchQuery("test");
		expect(result.values).toContain(25);
		expect(result.values).toContain(0);
	});
});

describe("buildCappedCountQuery", () => {
	it("returns SQL with LIMIT 10001 CTE", () => {
		const result = buildCappedCountQuery(
			"search_vector @@ plainto_tsquery('english', $1)",
			["test"],
		);
		expect(result.text).toContain("10001");
		expect(result.text).toContain("COUNT");
	});

	it("includes provided params in values", () => {
		const result = buildCappedCountQuery("source = $1", ["dataset_9"]);
		expect(result.values).toContain("dataset_9");
	});
});

describe("buildDocumentStatsQuery", () => {
	it("returns a valid SQL query for stats", () => {
		const result = buildDocumentStatsQuery();
		expect(result.text).toContain("SELECT");
		expect(result.text).toContain("documents");
		expect(result.values).toEqual([]);
	});
});

describe("buildEntityListQuery", () => {
	it("returns query with default limit and offset", () => {
		const result = buildEntityListQuery();
		expect(result.text).toContain("SELECT");
		expect(result.values.length).toBeGreaterThan(0);
	});

	it("filters by entity type when provided", () => {
		const result = buildEntityListQuery({ type: "Person" });
		expect(result.values).toContain("Person");
	});

	it("applies custom limit", () => {
		const result = buildEntityListQuery({ limit: 50 });
		expect(result.values).toContain(50);
	});
});
