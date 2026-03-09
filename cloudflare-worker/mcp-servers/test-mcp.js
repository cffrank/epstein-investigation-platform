#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function testServer(serverPath, serverName, tests) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`Testing: ${serverName}`);
	console.log("=".repeat(60));

	const transport = new StdioClientTransport({
		command: "node",
		args: [serverPath],
		env: {
			...process.env,
			PG_HOST: "localhost",
			PG_DATABASE: "platform",
			PG_USER: "investigation",
			PG_PASSWORD: process.env.PG_PASSWORD || "",
		},
	});

	const client = new Client(
		{
			name: "test-client",
			version: "1.0.0",
		},
		{
			capabilities: {},
		},
	);

	try {
		await client.connect(transport);
		console.log("✓ Connected to server\n");

		// List tools
		const tools = await client.listTools();
		console.log(`Available tools (${tools.tools.length}):`);
		for (const t of tools.tools) console.log(`  - ${t.name}`);
		console.log("");

		// Run tests
		for (const test of tests) {
			console.log(`\nTesting: ${test.name}`);
			console.log(`  Args: ${JSON.stringify(test.args)}`);

			try {
				const result = await client.callTool({
					name: test.name,
					arguments: test.args,
				});

				const text = result.content[0]?.text || "";
				const parsed = JSON.parse(text);

				// Show summary based on test
				if (test.name === "search_documents") {
					console.log(`  ✓ Found ${parsed.count} documents`);
					if (parsed.documents?.[0]) {
						console.log(`    First: ${parsed.documents[0].filename}`);
					}
				} else if (test.name === "get_document") {
					console.log(`  ✓ Got document: ${parsed.filename || "N/A"}`);
					console.log(`    Size: ${parsed.file_size_bytes} bytes`);
				} else if (test.name === "count_person_mentions") {
					console.log(`  ✓ ${parsed.person}: ${parsed.document_count} documents`);
				} else if (test.name === "get_database_stats") {
					console.log(`  ✓ Total documents: ${parsed.overview.total_documents}`);
					console.log(`    Datasets: ${parsed.by_dataset?.length}`);
				} else if (test.name === "get_subject_intelligence") {
					console.log(`  ✓ Notes: ${parsed.investigation_notes?.length || 0}`);
					console.log(`    Tagged docs: ${parsed.tagged_documents?.length || 0}`);
				} else if (test.name === "list_all_subjects") {
					console.log(`  ✓ Subjects: ${parsed.subjects?.length || 0}`);
				} else if (test.name === "check_source_credibility") {
					console.log(`  ✓ Tier: ${parsed.credibility_tier}, Bias: ${parsed.known_bias}`);
				} else if (test.name === "get_verification_scores") {
					console.log(`  ✓ Scores for ${parsed.scores?.length || 0} subjects`);
				} else if (test.name === "list_accused_perpetrators") {
					console.log(`  ✓ Accused: ${parsed.accused?.length || 0}`);
					if (parsed.accused) {
						for (const a of parsed.accused) console.log(`    - ${a.subject}: ${a.allegation_type}`);
					}
				} else {
					console.log("  ✓ Success");
				}
			} catch (err) {
				console.log(`  ✗ Error: ${err.message}`);
			}
		}

		await client.close();
		console.log("\n✓ Tests completed");
	} catch (err) {
		console.error(`✗ Connection failed: ${err.message}`);
	}
}

async function main() {
	const basePath = "/home/carl/project/Epstein/cloudflare-worker/mcp-servers";

	// Test epstein-documents
	await testServer(`${basePath}/epstein-documents/index.js`, "epstein-documents", [
		{ name: "get_database_stats", args: {} },
		{ name: "search_documents", args: { query: "Ehud Barak", limit: 5 } },
		{ name: "count_person_mentions", args: { name: "Prince Andrew" } },
		{ name: "get_document", args: { filename: "EFTA00095502.pdf" } },
	]);

	// Test epstein-intelligence
	await testServer(`${basePath}/epstein-intelligence/index.js`, "epstein-intelligence", [
		{ name: "list_all_subjects", args: {} },
		{ name: "get_subject_intelligence", args: { subject: "Ehud Barak" } },
		{ name: "check_source_credibility", args: { domain: "dailymail.co.uk" } },
		{ name: "get_verification_scores", args: {} },
		{ name: "list_accused_perpetrators", args: {} },
	]);

	console.log(`\n${"=".repeat(60)}`);
	console.log("All tests completed!");
	console.log("=".repeat(60));
}

main().catch(console.error);
