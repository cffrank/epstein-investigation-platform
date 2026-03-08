import { describe, it, expect } from "vitest";
import {
	validateRelationshipTypes,
	validateNodeLabels,
	buildTraversalQuery,
	buildNeighborsQuery,
	buildShortestPathQuery,
	ALLOWED_RELATIONSHIP_TYPES,
	ALLOWED_NODE_LABELS,
} from "./cypher.js";

describe("validateRelationshipTypes", () => {
	it("returns only valid types from allowlist", () => {
		const result = validateRelationshipTypes(["MENTIONED_IN", "EVIL_INJECTION"]);
		expect(result).toEqual(["MENTIONED_IN"]);
	});

	it("returns empty array for empty input", () => {
		expect(validateRelationshipTypes([])).toEqual([]);
	});

	it("returns empty array when no types match", () => {
		expect(validateRelationshipTypes(["INVALID", "FAKE"])).toEqual([]);
	});

	it("passes through all valid types", () => {
		const valid = ["MENTIONED_IN", "CONNECTED_TO", "ASSOCIATED_WITH"];
		expect(validateRelationshipTypes(valid)).toEqual(valid);
	});
});

describe("validateNodeLabels", () => {
	it("returns only valid labels from allowlist", () => {
		const result = validateNodeLabels(["Person", "EvilLabel"]);
		expect(result).toEqual(["Person"]);
	});

	it("returns empty array for empty input", () => {
		expect(validateNodeLabels([])).toEqual([]);
	});
});

describe("buildTraversalQuery", () => {
	it("returns parameterized Cypher with no string interpolation of user input", () => {
		const result = buildTraversalQuery(["MENTIONED_IN"], 2);
		expect(result.query).toContain("$");
		expect(result.query).not.toContain("EVIL");
		expect(result.params).toBeDefined();
	});

	it("clamps depth > 4 to 4", () => {
		const result = buildTraversalQuery(["MENTIONED_IN"], 10);
		expect(result.params.maxDepth).toBe(4);
	});

	it("clamps depth < 1 to 1", () => {
		const result = buildTraversalQuery(["MENTIONED_IN"], 0);
		expect(result.params.maxDepth).toBe(1);
	});

	it("clamps negative depth to 1", () => {
		const result = buildTraversalQuery(["MENTIONED_IN"], -5);
		expect(result.params.maxDepth).toBe(1);
	});

	it("filters invalid relationship types", () => {
		const result = buildTraversalQuery(["MENTIONED_IN", "INJECTION"], 2);
		// Only valid types should be used
		expect(result.query).not.toContain("INJECTION");
	});
});

describe("buildNeighborsQuery", () => {
	it("returns parameterized Cypher query", () => {
		const result = buildNeighborsQuery();
		expect(result.query).toContain("MATCH");
		expect(result.query).toContain("$");
	});
});

describe("buildShortestPathQuery", () => {
	it("returns parameterized Cypher query", () => {
		const result = buildShortestPathQuery();
		expect(result.query).toContain("shortestPath");
		expect(result.query).toContain("$");
	});
});

describe("ALLOWED_RELATIONSHIP_TYPES", () => {
	it("contains expected types", () => {
		expect(ALLOWED_RELATIONSHIP_TYPES.has("MENTIONED_IN")).toBe(true);
		expect(ALLOWED_RELATIONSHIP_TYPES.has("CONNECTED_TO")).toBe(true);
	});
});

describe("ALLOWED_NODE_LABELS", () => {
	it("contains expected labels", () => {
		expect(ALLOWED_NODE_LABELS.has("Person")).toBe(true);
		expect(ALLOWED_NODE_LABELS.has("Organization")).toBe(true);
		expect(ALLOWED_NODE_LABELS.has("Location")).toBe(true);
		expect(ALLOWED_NODE_LABELS.has("Document")).toBe(true);
		expect(ALLOWED_NODE_LABELS.has("Event")).toBe(true);
	});
});
