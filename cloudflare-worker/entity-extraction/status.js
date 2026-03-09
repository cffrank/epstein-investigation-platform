#!/usr/bin/env node

import neo4j from "neo4j-driver";
import pg from "pg";

const { Pool } = pg;

const pgPool = new Pool({
	host: process.env.PG_HOST || "localhost",
	port: Number.parseInt(process.env.PG_PORT || "5432"),
	database: process.env.PG_DATABASE || "platform",
	user: process.env.PG_USER || "investigation",
	password: process.env.PG_PASSWORD,
});

const neo4jDriver = neo4j.driver(
	`bolt://${process.env.NEO4J_HOST || "localhost"}:${process.env.NEO4J_BOLT_PORT || "7687"}`,
	neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password"),
);

async function main() {
	console.log("=== Entity Extraction Status ===\n");

	// Get PostgreSQL stats
	const totalDocs = await pgPool.query(`
    SELECT COUNT(*) as total FROM documents WHERE metadata->>'extracted_text' IS NOT NULL
  `);

	const progress = await pgPool
		.query(`
    SELECT current_offset, stats, updated_at FROM extraction_progress WHERE id = 1
  `)
		.catch(() => ({ rows: [] }));

	console.log("PostgreSQL:");
	console.log(`  Documents with text: ${totalDocs.rows[0].total}`);

	if (progress.rows.length > 0) {
		const p = progress.rows[0];
		console.log(`  Current offset: ${p.current_offset}`);
		console.log(`  Progress: ${((p.current_offset / totalDocs.rows[0].total) * 100).toFixed(2)}%`);
		console.log(`  Last updated: ${p.updated_at}`);
		console.log("  Stats:", p.stats);
	} else {
		console.log("  No extraction progress recorded yet");
	}

	// Get Neo4j stats
	const session = neo4jDriver.session();
	try {
		console.log("\nNeo4j Graph:");

		const nodeStats = await session.run(`
      MATCH (n)
      RETURN labels(n)[0] as label, count(n) as count
      ORDER BY count DESC
    `);

		for (const record of nodeStats.records) {
			console.log(`  ${record.get("label")}: ${record.get("count").toNumber()}`);
		}

		const relStats = await session.run(`
      MATCH ()-[r]->()
      RETURN type(r) as type, count(r) as count
      ORDER BY count DESC
    `);

		console.log("\nRelationships:");
		for (const record of relStats.records) {
			console.log(`  ${record.get("type")}: ${record.get("count").toNumber()}`);
		}

		// Top mentioned people
		const topPeople = await session.run(`
      MATCH (p:Person)-[r:MENTIONED_IN]->()
      RETURN p.name as name, count(r) as mentions
      ORDER BY mentions DESC
      LIMIT 20
    `);

		if (topPeople.records.length > 0) {
			console.log("\nTop 20 Most Mentioned People:");
			for (const record of topPeople.records) {
				console.log(`  ${record.get("name")}: ${record.get("mentions").toNumber()} docs`);
			}
		}
	} finally {
		await session.close();
	}

	await pgPool.end();
	await neo4jDriver.close();
}

main().catch(console.error);
