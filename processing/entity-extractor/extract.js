#!/usr/bin/env node
/**
 * Entity Extractor - Extracts entities from documents and stores in Neo4j
 *
 * Uses compromise NLP library for Named Entity Recognition.
 * Extracts: People, Organizations, Places
 * Creates relationships between documents and entities in Neo4j.
 *
 * Uses FOR UPDATE SKIP LOCKED for atomic document claiming.
 */

import nlp from 'compromise';
import neo4j from 'neo4j-driver';
import pg from 'pg';

// Configuration
const config = {
  pg: {
    host: process.env.PG_HOST || 'postgres',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'platform',
    user: process.env.PG_USER || 'investigation',
    password: process.env.PG_PASSWORD || ''
  },
  neo4j: {
    host: process.env.NEO4J_HOST || 'neo4j',
    port: parseInt(process.env.NEO4J_BOLT_PORT || '7687'),
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || ''
  },
  batchSize: parseInt(process.env.BATCH_SIZE || '50'),
  workerId: process.env.WORKER_ID || '1'
};

const neo4jUri = `bolt://${config.neo4j.host}:${config.neo4j.port}`;

// Logger
function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[Entity-Worker-${config.workerId}] ${timestamp} - ${level} - ${message}`);
}

// PostgreSQL pool
const pgPool = new pg.Pool(config.pg);

// Neo4j driver
const driver = neo4j.driver(
  neo4jUri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
);

/**
 * Extract entities from text using compromise NLP
 */
function extractEntities(text) {
  const doc = nlp(text);

  // Extract different entity types
  const people = doc.people().out('array');
  const places = doc.places().out('array');
  const organizations = doc.organizations().out('array');

  // Deduplicate and clean
  const cleanEntities = (entities) => {
    const seen = new Set();
    return entities
      .map(e => e.trim())
      .filter(e => e.length > 2 && e.length < 100)  // Filter too short/long
      .filter(e => {
        const lower = e.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      })
      .slice(0, 50);  // Limit per type
  };

  return {
    people: cleanEntities(people),
    organizations: cleanEntities(organizations),
    places: cleanEntities(places)
  };
}

/**
 * Claim documents for entity extraction
 */
async function claimDocuments(limit) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(`
      WITH claimed AS (
        SELECT id, filename, source, metadata
        FROM documents
        WHERE metadata->>'text' IS NOT NULL
          AND LENGTH(metadata->>'text') > 100
          AND (metadata IS NULL OR metadata->>'entities_extracted' IS NULL)
          AND (metadata IS NULL OR metadata->>'entity_error' IS NULL)
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE documents d
      SET metadata = COALESCE(d.metadata, '{}'::jsonb) ||
                     jsonb_build_object('entity_extraction_started', NOW()::text, 'entity_worker_id', $2::text)
      FROM claimed c
      WHERE d.id = c.id
      RETURNING d.id, d.filename, d.source, d.metadata
    `, [limit, config.workerId]);

    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Store entities in Neo4j
 */
async function storeEntities(session, docId, filename, source, entities) {
  const tx = session.beginTransaction();

  try {
    // Create or update document node
    await tx.run(`
      MERGE (d:Document {id: $docId})
      SET d.filename = $filename,
          d.source = $source,
          d.updated_at = datetime()
    `, { docId, filename, source });

    // Create Person nodes and relationships
    for (const person of entities.people) {
      await tx.run(`
        MERGE (p:Person {name: $name})
        WITH p
        MATCH (d:Document {id: $docId})
        MERGE (p)-[r:MENTIONED_IN]->(d)
        SET r.extracted_at = datetime()
      `, { name: person, docId });
    }

    // Create Organization nodes and relationships
    for (const org of entities.organizations) {
      await tx.run(`
        MERGE (o:Organization {name: $name})
        WITH o
        MATCH (d:Document {id: $docId})
        MERGE (o)-[r:MENTIONED_IN]->(d)
        SET r.extracted_at = datetime()
      `, { name: org, docId });
    }

    // Create Place nodes and relationships
    for (const place of entities.places) {
      await tx.run(`
        MERGE (l:Location {name: $name})
        WITH l
        MATCH (d:Document {id: $docId})
        MERGE (l)-[r:MENTIONED_IN]->(d)
        SET r.extracted_at = datetime()
      `, { name: place, docId });
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

/**
 * Update document after successful entity extraction
 */
async function updateDocumentSuccess(docId, entityCounts) {
  await pgPool.query(`
    UPDATE documents
    SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                   jsonb_build_object(
                     'entities_extracted', true,
                     'entity_counts', $1::jsonb,
                     'entity_extraction_completed', NOW()::text,
                     'entity_worker_id', $2::text
                   ),
        processed_at = NOW()
    WHERE id = $3
  `, [JSON.stringify(entityCounts), config.workerId, docId]);
}

/**
 * Mark document with entity extraction error
 */
async function markDocumentError(docId, error) {
  await pgPool.query(`
    UPDATE documents
    SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                   jsonb_build_object('entity_error', $1::text, 'entity_worker_id', $2::text),
        processed_at = NOW()
    WHERE id = $3
  `, [error, config.workerId, docId]);
}

/**
 * Process a batch of documents
 */
async function processBatch() {
  const documents = await claimDocuments(config.batchSize);

  if (documents.length === 0) {
    return 0;
  }

  log('INFO', `Processing batch of ${documents.length} documents`);

  const session = driver.session();
  let processed = 0;

  try {
    for (const doc of documents) {
      const docId = doc.id;
      const filename = doc.filename;
      const source = doc.source;
      const metadata = doc.metadata || {};
      const text = metadata.text || '';

      if (text.length < 100) {
        log('WARN', `Insufficient text for ${filename}`);
        await markDocumentError(docId, 'insufficient_text');
        processed++;
        continue;
      }

      try {
        // Extract entities
        const entities = extractEntities(text);

        const entityCounts = {
          people: entities.people.length,
          organizations: entities.organizations.length,
          places: entities.places.length
        };

        // Only store if we found entities
        const totalEntities = entityCounts.people + entityCounts.organizations + entityCounts.places;

        if (totalEntities > 0) {
          await storeEntities(session, docId, filename, source, entities);
          log('INFO', `Extracted entities from ${filename}: ${JSON.stringify(entityCounts)}`);
        } else {
          log('INFO', `No entities found in ${filename}`);
        }

        await updateDocumentSuccess(docId, entityCounts);

      } catch (error) {
        log('ERROR', `Error processing ${filename}: ${error.message}`);
        await markDocumentError(docId, error.message);
      }

      processed++;
    }
  } finally {
    await session.close();
  }

  return processed;
}

/**
 * Get processing statistics
 */
async function getStats() {
  const result = await pgPool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
      COUNT(CASE WHEN metadata->>'entities_extracted' = 'true' THEN 1 END) as has_entities,
      COUNT(CASE WHEN metadata->>'entity_error' IS NOT NULL THEN 1 END) as errors
    FROM documents
    WHERE filename LIKE '%.pdf'
  `);
  return result.rows[0];
}

/**
 * Ensure Neo4j constraints exist
 */
async function ensureConstraints() {
  const session = driver.session();
  try {
    // Create constraints for uniqueness
    await session.run('CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE');
    await session.run('CREATE CONSTRAINT org_name IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE');
    await session.run('CREATE CONSTRAINT location_name IF NOT EXISTS FOR (l:Location) REQUIRE l.name IS UNIQUE');
    log('INFO', 'Neo4j constraints ensured');
  } catch (error) {
    // Constraints might already exist
    log('WARN', `Constraint setup: ${error.message}`);
  } finally {
    await session.close();
  }
}

/**
 * Main processing loop
 */
async function main() {
  log('INFO', `Starting Entity Extractor Worker ${config.workerId}`);
  log('INFO', `Batch size: ${config.batchSize}`);

  // Test connections
  try {
    await pgPool.query('SELECT 1');
    log('INFO', 'PostgreSQL connected');
  } catch (error) {
    log('ERROR', `PostgreSQL connection failed: ${error.message}`);
    process.exit(1);
  }

  try {
    const session = driver.session();
    await session.run('RETURN 1');
    await session.close();
    log('INFO', 'Neo4j connected');
  } catch (error) {
    log('ERROR', `Neo4j connection failed: ${error.message}`);
    process.exit(1);
  }

  // Ensure constraints
  await ensureConstraints();

  // Print initial stats
  const stats = await getStats();
  log('INFO', `Initial stats: ${JSON.stringify(stats)}`);

  let totalProcessed = 0;
  let consecutiveEmpty = 0;

  // Handle shutdown
  process.on('SIGINT', async () => {
    log('INFO', 'Shutting down...');
    await driver.close();
    await pgPool.end();
    process.exit(0);
  });

  // Main loop
  while (true) {
    try {
      const processed = await processBatch();
      totalProcessed += processed;

      if (processed === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) {
          log('INFO', `No documents to process. Total: ${totalProcessed}. Waiting 30s...`);
          await new Promise(resolve => setTimeout(resolve, 30000));
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } else {
        consecutiveEmpty = 0;
        log('INFO', `Batch complete. Total processed: ${totalProcessed}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      log('ERROR', `Batch error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

main().catch(error => {
  log('ERROR', `Fatal error: ${error.message}`);
  process.exit(1);
});
