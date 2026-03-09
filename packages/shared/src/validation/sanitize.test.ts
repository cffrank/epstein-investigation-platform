import { describe, expect, it } from "vitest";
import {
	CHAT_CONTENT_SANITIZE_CONFIG,
	DOCUMENT_TEXT_SANITIZE_CONFIG,
	SEARCH_SNIPPET_SANITIZE_CONFIG,
	validatePaginationParams,
	validateSearchQuery,
} from "./sanitize.js";

describe("SEARCH_SNIPPET_SANITIZE_CONFIG", () => {
	it("allows only mark tags", () => {
		expect(SEARCH_SNIPPET_SANITIZE_CONFIG.ALLOWED_TAGS).toEqual(["mark"]);
		expect(SEARCH_SNIPPET_SANITIZE_CONFIG.ALLOWED_ATTR).toEqual([]);
	});
});

describe("CHAT_CONTENT_SANITIZE_CONFIG", () => {
	it("allows formatting tags", () => {
		const tags = CHAT_CONTENT_SANITIZE_CONFIG.ALLOWED_TAGS;
		expect(tags).toContain("p");
		expect(tags).toContain("strong");
		expect(tags).toContain("em");
		expect(tags).toContain("code");
		expect(tags).toContain("a");
		expect(tags).toContain("mark");
	});

	it("allows href and class attributes", () => {
		expect(CHAT_CONTENT_SANITIZE_CONFIG.ALLOWED_ATTR).toContain("href");
		expect(CHAT_CONTENT_SANITIZE_CONFIG.ALLOWED_ATTR).toContain("class");
	});
});

describe("DOCUMENT_TEXT_SANITIZE_CONFIG", () => {
	it("allows mark and span with class", () => {
		expect(DOCUMENT_TEXT_SANITIZE_CONFIG.ALLOWED_TAGS).toContain("mark");
		expect(DOCUMENT_TEXT_SANITIZE_CONFIG.ALLOWED_TAGS).toContain("span");
		expect(DOCUMENT_TEXT_SANITIZE_CONFIG.ALLOWED_ATTR).toContain("class");
	});
});

describe("validateSearchQuery", () => {
	it("trims whitespace", () => {
		expect(validateSearchQuery("  hello  ")).toBe("hello");
	});

	it("throws on empty string", () => {
		expect(() => validateSearchQuery("")).toThrow();
	});

	it("throws on whitespace-only string", () => {
		expect(() => validateSearchQuery("   ")).toThrow();
	});

	it("caps at 500 chars", () => {
		const long = "a".repeat(600);
		const result = validateSearchQuery(long);
		expect(result.length).toBe(500);
	});
});

describe("validatePaginationParams", () => {
	it("coerces strings to numbers", () => {
		const result = validatePaginationParams("3", "20");
		expect(result).toEqual({ page: 3, limit: 20 });
	});

	it("defaults to page 1, limit 25", () => {
		const result = validatePaginationParams(undefined, undefined);
		expect(result).toEqual({ page: 1, limit: 25 });
	});

	it("caps limit at 100", () => {
		const result = validatePaginationParams(1, 500);
		expect(result).toEqual({ page: 1, limit: 100 });
	});

	it("floors negative values", () => {
		const result = validatePaginationParams(-5, -10);
		expect(result).toEqual({ page: 1, limit: 1 });
	});

	it("handles NaN gracefully", () => {
		const result = validatePaginationParams("abc", "xyz");
		expect(result).toEqual({ page: 1, limit: 25 });
	});
});
