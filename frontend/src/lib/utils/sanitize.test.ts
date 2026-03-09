import { describe, expect, it } from "vitest";
import { sanitizeChatContent, sanitizeDocumentText, sanitizeSearchSnippet } from "./sanitize";

describe("sanitizeSearchSnippet", () => {
	it("preserves mark tags", () => {
		const input = "found <mark>result</mark> here";
		expect(sanitizeSearchSnippet(input)).toContain("<mark>");
	});

	it("strips script tags", () => {
		const input = 'text <script>alert("xss")</script> more';
		const result = sanitizeSearchSnippet(input);
		expect(result).not.toContain("<script>");
		expect(result).not.toContain("alert");
	});

	it("strips onclick attributes", () => {
		const input = '<mark onclick="alert(1)">text</mark>';
		const result = sanitizeSearchSnippet(input);
		expect(result).not.toContain("onclick");
	});

	it("strips img with onerror", () => {
		const input = "<img src=x onerror=alert(1)>";
		const result = sanitizeSearchSnippet(input);
		expect(result).not.toContain("<img");
		expect(result).not.toContain("onerror");
	});
});

describe("sanitizeChatContent", () => {
	it("preserves allowed formatting tags", () => {
		const input = "<p>Hello <strong>world</strong> <em>italic</em> <code>code</code></p>";
		const result = sanitizeChatContent(input);
		expect(result).toContain("<p>");
		expect(result).toContain("<strong>");
		expect(result).toContain("<em>");
		expect(result).toContain("<code>");
	});

	it("preserves a tags with href", () => {
		const input = '<a href="https://example.com">link</a>';
		const result = sanitizeChatContent(input);
		expect(result).toContain("href=");
	});

	it("strips iframe", () => {
		const input = '<iframe src="evil.com"></iframe>';
		const result = sanitizeChatContent(input);
		expect(result).not.toContain("<iframe");
	});

	it("strips script", () => {
		const input = "<script>alert(1)</script>";
		const result = sanitizeChatContent(input);
		expect(result).not.toContain("<script");
	});
});

describe("sanitizeDocumentText", () => {
	it("preserves mark tags", () => {
		const input = "<mark>highlighted</mark>";
		expect(sanitizeDocumentText(input)).toContain("<mark>");
	});

	it("preserves span with class", () => {
		const input = '<span class="entity">John</span>';
		const result = sanitizeDocumentText(input);
		expect(result).toContain("<span");
		expect(result).toContain("class=");
	});

	it("strips everything else", () => {
		const input = "<div><p>text</p><script>evil</script></div>";
		const result = sanitizeDocumentText(input);
		expect(result).not.toContain("<div");
		expect(result).not.toContain("<p>");
		expect(result).not.toContain("<script");
	});
});
