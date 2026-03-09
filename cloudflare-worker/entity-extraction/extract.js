#!/usr/bin/env node

import nlp from "compromise";
import neo4j from "neo4j-driver";
import pg from "pg";

const { Pool } = pg;

// Configuration
const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || "100");
const MAX_TEXT_LENGTH = Number.parseInt(process.env.MAX_TEXT_LENGTH || "50000");
const START_OFFSET = Number.parseInt(process.env.START_OFFSET || "0");

// Known important names in the Epstein case for better matching
const KNOWN_NAMES = new Set([
	"jeffrey epstein",
	"ghislaine maxwell",
	"prince andrew",
	"virginia giuffre",
	"virginia roberts",
	"alan dershowitz",
	"bill clinton",
	"donald trump",
	"les wexner",
	"jean-luc brunel",
	"sarah kellen",
	"nadia marcinkova",
	"ehud barak",
	"bill richardson",
	"george mitchell",
	"marvin minsky",
	"glenn dubin",
	"eva andersson-dubin",
	"leon black",
	"mort zuckerman",
	"steve bannon",
	"kevin spacey",
	"chris tucker",
	"naomi campbell",
	"courtney love",
	"tony blair",
	"larry summers",
	"stephen hawking",
	"reid hoffman",
	"bill gates",
	"woody allen",
	"leslie wexner",
	"sarah ransome",
	"maria farmer",
	"annie farmer",
	"johanna sjoberg",
	"maxwell family",
	"robert maxwell",
	"alexander acosta",
]);

// Database connections
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

// Create indexes in Neo4j for better performance
async function createIndexes() {
	const session = neo4jDriver.session();
	try {
		console.log("Creating Neo4j indexes...");

		const indexes = [
			"CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)",
			"CREATE INDEX org_name IF NOT EXISTS FOR (o:Organization) ON (o.name)",
			"CREATE INDEX location_name IF NOT EXISTS FOR (l:Location) ON (l.name)",
			"CREATE INDEX document_id IF NOT EXISTS FOR (d:Document) ON (d.doc_id)",
			"CREATE INDEX document_filename IF NOT EXISTS FOR (d:Document) ON (d.filename)",
		];

		for (const idx of indexes) {
			try {
				await session.run(idx);
			} catch (e) {
				// Index may already exist
			}
		}
		console.log("Indexes created/verified");
	} finally {
		await session.close();
	}
}

// Extract entities from text using compromise NLP
function extractEntities(text) {
	if (!text || text.length < 10) return { people: [], organizations: [], locations: [] };

	// Truncate very long texts
	const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

	const doc = nlp(truncatedText);

	// Extract people
	const people = new Set();

	// Get names from NLP
	for (const p of doc.people()) {
		const name = p.text().trim();
		if (name.length > 2 && name.length < 100) {
			people.add(normalizeName(name));
		}
	}

	// Also check for known names
	const lowerText = truncatedText.toLowerCase();
	for (const knownName of KNOWN_NAMES) {
		if (lowerText.includes(knownName)) {
			people.add(normalizeName(knownName));
		}
	}

	// Extract organizations
	const organizations = new Set();
	for (const o of doc.organizations()) {
		const name = o.text().trim();
		if (name.length > 2 && name.length < 100) {
			organizations.add(name);
		}
	}

	// Extract locations
	const locations = new Set();
	for (const l of doc.places()) {
		const name = l.text().trim();
		if (name.length > 2 && name.length < 100) {
			locations.add(name);
		}
	}

	return {
		people: [...people].filter((p) => p.split(" ").length >= 2), // Require at least 2 words for names
		organizations: [...organizations],
		locations: [...locations],
	};
}

// Normalize person names
function normalizeName(name) {
	return name
		.split(" ")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

// Store entities in Neo4j
async function storeEntities(session, docId, filename, source, entities) {
	const { people, organizations, locations } = entities;

	// Create or update document node
	await session.run(
		`
    MERGE (d:Document {doc_id: $docId})
    SET d.filename = $filename, d.source = $source, d.processed_at = datetime()
  `,
		{ docId, filename, source },
	);

	// Create person nodes and relationships
	for (const personName of people) {
		await session.run(
			`
      MERGE (p:Person {name: $name})
      WITH p
      MATCH (d:Document {doc_id: $docId})
      MERGE (p)-[:MENTIONED_IN]->(d)
    `,
			{ name: personName, docId },
		);
	}

	// Create co-mention relationships between people in same document
	if (people.length >= 2) {
		for (let i = 0; i < people.length; i++) {
			for (let j = i + 1; j < people.length; j++) {
				await session.run(
					`
          MATCH (p1:Person {name: $name1})
          MATCH (p2:Person {name: $name2})
          MERGE (p1)-[r:CO_MENTIONED]-(p2)
          ON CREATE SET r.count = 1
          ON MATCH SET r.count = r.count + 1
        `,
					{ name1: people[i], name2: people[j] },
				);
			}
		}
	}

	// Create organization nodes and relationships
	for (const orgName of organizations) {
		await session.run(
			`
      MERGE (o:Organization {name: $name})
      WITH o
      MATCH (d:Document {doc_id: $docId})
      MERGE (o)-[:MENTIONED_IN]->(d)
    `,
			{ name: orgName, docId },
		);
	}

	// Create location nodes and relationships
	for (const locName of locations) {
		await session.run(
			`
      MERGE (l:Location {name: $name})
      WITH l
      MATCH (d:Document {doc_id: $docId})
      MERGE (l)-[:MENTIONED_IN]->(d)
    `,
			{ name: locName, docId },
		);
	}

	return {
		people: people.length,
		organizations: organizations.length,
		locations: locations.length,
	};
}

// Process a batch of documents
async function processBatch(offset) {
	const pgClient = await pgPool.connect();
	const session = neo4jDriver.session();

	try {
		// Get batch of documents with extracted text
		const result = await pgClient.query(
			`
      SELECT id, filename, source, metadata->>'extracted_text' as text
      FROM documents
      WHERE metadata->>'extracted_text' IS NOT NULL
        AND length(metadata->>'extracted_text') > 100
      ORDER BY id
      OFFSET $1 LIMIT $2
    `,
			[offset, BATCH_SIZE],
		);

		if (result.rows.length === 0) {
			return { processed: 0, done: true };
		}

		let totalPeople = 0;
		let totalOrgs = 0;
		let totalLocs = 0;

		for (const doc of result.rows) {
			try {
				const entities = extractEntities(doc.text);
				const counts = await storeEntities(session, doc.id, doc.filename, doc.source, entities);

				totalPeople += counts.people;
				totalOrgs += counts.organizations;
				totalLocs += counts.locations;
			} catch (err) {
				console.error(`Error processing doc ${doc.filename}:`, err.message);
			}
		}

		return {
			processed: result.rows.length,
			done: result.rows.length < BATCH_SIZE,
			entities: { people: totalPeople, organizations: totalOrgs, locations: totalLocs },
		};
	} finally {
		pgClient.release();
		await session.close();
	}
}

// Save progress to PostgreSQL
async function saveProgress(offset, stats) {
	try {
		await pgPool.query(
			`
      INSERT INTO extraction_progress (id, current_offset, stats, updated_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        current_offset = $1, stats = $2, updated_at = NOW()
    `,
			[offset, JSON.stringify(stats)],
		);
	} catch (err) {
		// Table might not exist yet
		await pgPool.query(`
      CREATE TABLE IF NOT EXISTS extraction_progress (
        id INT PRIMARY KEY,
        current_offset INT,
        stats JSONB,
        updated_at TIMESTAMP
      )
    `);
		await pgPool.query(
			`
      INSERT INTO extraction_progress (id, current_offset, stats, updated_at)
      VALUES (1, $1, $2, NOW())
    `,
			[offset, JSON.stringify(stats)],
		);
	}
}

// Load progress
async function loadProgress() {
	try {
		const result = await pgPool.query(`
      SELECT current_offset, stats FROM extraction_progress WHERE id = 1
    `);
		if (result.rows.length > 0) {
			return {
				offset: result.rows[0].current_offset,
				stats: result.rows[0].stats || {},
			};
		}
	} catch (err) {
		// Table doesn't exist yet
	}
	return {
		offset: START_OFFSET,
		stats: { totalDocs: 0, totalPeople: 0, totalOrgs: 0, totalLocs: 0 },
	};
}

// Main extraction loop
async function main() {
	console.log("Entity Extraction Service Starting...");
	console.log(`Batch size: ${BATCH_SIZE}`);

	await createIndexes();

	// Load previous progress
	let { offset, stats } = await loadProgress();
	console.log(`Resuming from offset: ${offset}`);
	console.log("Previous stats:", stats);

	let running = true;

	// Handle graceful shutdown
	process.on("SIGINT", () => {
		console.log("\nShutting down gracefully...");
		running = false;
	});
	process.on("SIGTERM", () => {
		console.log("\nShutting down gracefully...");
		running = false;
	});

	while (running) {
		const startTime = Date.now();
		const result = await processBatch(offset);
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

		if (result.processed > 0) {
			offset += result.processed;
			stats.totalDocs = (stats.totalDocs || 0) + result.processed;
			stats.totalPeople = (stats.totalPeople || 0) + (result.entities?.people || 0);
			stats.totalOrgs = (stats.totalOrgs || 0) + (result.entities?.organizations || 0);
			stats.totalLocs = (stats.totalLocs || 0) + (result.entities?.locations || 0);

			console.log(
				`[${new Date().toISOString()}] Processed ${result.processed} docs (offset: ${offset}) in ${elapsed}s | ` +
					`People: +${result.entities?.people || 0} | Orgs: +${result.entities?.organizations || 0} | Locs: +${result.entities?.locations || 0}`,
			);

			// Save progress every batch
			await saveProgress(offset, stats);
		}

		if (result.done) {
			console.log("\n=== Extraction Complete ===");
			console.log(`Total documents processed: ${stats.totalDocs}`);
			console.log(`Total people extracted: ${stats.totalPeople}`);
			console.log(`Total organizations extracted: ${stats.totalOrgs}`);
			console.log(`Total locations extracted: ${stats.totalLocs}`);
			break;
		}

		// Small delay between batches
		await new Promise((r) => setTimeout(r, 100));
	}

	await pgPool.end();
	await neo4jDriver.close();
	console.log("Entity extraction service stopped.");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
