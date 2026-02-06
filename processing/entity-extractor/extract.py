#!/usr/bin/env python3
"""
Entity Extractor - Extracts entities using Cerebras LLM API with concurrent processing.

Uses Llama 3.1 8B via Cerebras for fast, accurate Named Entity Recognition.
Extracts People, Organizations, and Locations from document text.
Stores relationships in Neo4j graph database.
"""

import os
import sys
import time
import json
import logging
import re
import threading
from typing import Optional, List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from neo4j import GraphDatabase

# Configuration
PG_HOST = os.environ.get('PG_HOST', 'postgres')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

NEO4J_HOST = os.environ.get('NEO4J_HOST', 'neo4j')
NEO4J_BOLT_PORT = int(os.environ.get('NEO4J_BOLT_PORT', 7687))
NEO4J_USER = os.environ.get('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.environ.get('NEO4J_PASSWORD', '')

# Cerebras API configuration
CEREBRAS_API_KEY = os.environ.get('CEREBRAS_API_KEY', '')
CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions'
CEREBRAS_MODEL = os.environ.get('CEREBRAS_MODEL', 'llama3.1-8b')

BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 50))
MAX_TEXT_LENGTH = int(os.environ.get('MAX_TEXT_LENGTH', 4000))
REQUESTS_PER_MINUTE = int(os.environ.get('REQUESTS_PER_MINUTE', 1000))
CONCURRENT_REQUESTS = int(os.environ.get('CONCURRENT_REQUESTS', 20))  # Concurrent API calls
WORKER_ID = os.environ.get('WORKER_ID', '1')

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format=f'[Entity-Worker-{WORKER_ID}] %(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Entity extraction prompt - system prompt is static (gets cached by Cerebras)
SYSTEM_PROMPT = """You are an entity extraction system. Extract named entities from documents and return structured JSON.

Rules:
- Extract full names when possible (e.g., "Jeffrey Epstein" not just "Epstein")
- Deduplicate entities (don't repeat the same entity)
- Only include clearly identifiable entities, skip vague references
- Return empty arrays if no entities of that type are found"""

# JSON schema for structured output (eliminates parsing errors)
ENTITY_SCHEMA = {
    "type": "object",
    "properties": {
        "people": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Names of individuals mentioned"
        },
        "organizations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Companies, agencies, institutions mentioned"
        },
        "locations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Places, cities, countries mentioned"
        }
    },
    "required": ["people", "organizations", "locations"],
    "additionalProperties": False
}


def get_db_connection():
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        database=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD
    )


def get_neo4j_driver():
    uri = f"bolt://{NEO4J_HOST}:{NEO4J_BOLT_PORT}"
    return GraphDatabase.driver(uri, auth=(NEO4J_USER, NEO4J_PASSWORD))


def create_neo4j_indexes(driver):
    """Create indexes in Neo4j for better performance."""
    with driver.session() as session:
        indexes = [
            "CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)",
            "CREATE INDEX org_name IF NOT EXISTS FOR (o:Organization) ON (o.name)",
            "CREATE INDEX location_name IF NOT EXISTS FOR (l:Location) ON (l.name)",
            "CREATE INDEX document_id IF NOT EXISTS FOR (d:Document) ON (d.doc_id)",
        ]
        for idx in indexes:
            try:
                session.run(idx)
            except Exception:
                pass
    logger.info("Neo4j indexes created/verified")


def extract_entities_llm(text: str) -> Optional[Dict[str, List[str]]]:
    """Extract entities using Cerebras LLM API (no rate limiting - handled by concurrency)."""
    # Truncate text if too long
    truncated_text = text[:MAX_TEXT_LENGTH] if len(text) > MAX_TEXT_LENGTH else text

    headers = {
        'Authorization': f'Bearer {CEREBRAS_API_KEY}',
        'Content-Type': 'application/json'
    }

    payload = {
        'model': CEREBRAS_MODEL,
        'messages': [
            {
                'role': 'system',
                'content': SYSTEM_PROMPT  # Static - gets cached by Cerebras
            },
            {
                'role': 'user',
                'content': f"Extract entities from this document:\n\n{truncated_text}"
            }
        ],
        'max_completion_tokens': 200,  # Reduced from 300 - entity JSON is ~150 tokens
        'temperature': 0.1,
        'service_tier': 'flex',  # Higher throughput for batch workloads
        'response_format': {
            'type': 'json_schema',
            'json_schema': {
                'name': 'entities',
                'strict': True,
                'schema': ENTITY_SCHEMA
            }
        }
    }

    try:
        response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload, timeout=30)

        if response.status_code == 429:
            logger.warning("Rate limited, waiting 5s...")
            time.sleep(5)
            return None

        if response.status_code != 200:
            logger.error(f"API error {response.status_code}: {response.text[:200]}")
            return None

        result = response.json()
        content = result.get('choices', [{}])[0].get('message', {}).get('content', '')

        # With structured output, content should be valid JSON
        # Fall back to regex extraction if needed
        try:
            entities = json.loads(content)
            return {
                'people': entities.get('people', []),
                'organizations': entities.get('organizations', []),
                'locations': entities.get('locations', [])
            }
        except json.JSONDecodeError:
            # Fallback: try regex extraction
            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            if json_match:
                entities = json.loads(json_match.group())
                return {
                    'people': entities.get('people', []),
                    'organizations': entities.get('organizations', []),
                    'locations': entities.get('locations', [])
                }
            else:
                logger.warning(f"Could not parse JSON from response: {content[:200]}")
                return None

    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}")
        return None
    except requests.exceptions.Timeout:
        logger.error("Request timeout")
        return None
    except Exception as e:
        logger.error(f"Error: {e}")
        return None


def process_single_doc(doc: dict) -> Tuple[str, str, str, Optional[Dict], str]:
    """Process a single document - extract entities via LLM. Returns (doc_id, filename, source, entities, error)."""
    doc_id = str(doc['id'])
    filename = doc['filename']
    source = doc['source']
    metadata = doc['metadata'] or {}

    text = metadata.get('text', '')
    if not text or len(text) < 100:
        return (doc_id, filename, source, None, "insufficient_text")

    entities = extract_entities_llm(text)
    if entities is None:
        return (doc_id, filename, source, None, "extraction_failed")

    return (doc_id, filename, source, entities, None)


def store_entities_neo4j_batch(driver, results: List[Tuple[str, str, str, Optional[Dict], str]]):
    """Store all extracted entities from a batch in Neo4j using deadlock-resistant approach.

    Strategy: Separate entity creation from relationship creation, and process
    entities in sorted order for consistent lock acquisition across workers.
    """
    import random

    # Prepare batch data
    documents = []
    people_names = set()
    org_names = set()
    location_names = set()
    relationships = []  # (entity_type, name, doc_id)

    for doc_id, filename, source, entities, error in results:
        if error or entities is None:
            continue

        documents.append({
            'doc_id': doc_id,
            'filename': filename,
            'source': source
        })

        for person in entities.get('people', []):
            name = person.strip() if person else ''
            if len(name) > 1:
                people_names.add(name)
                relationships.append(('Person', name, doc_id))

        for org in entities.get('organizations', []):
            name = org.strip() if org else ''
            if len(name) > 1:
                org_names.add(name)
                relationships.append(('Organization', name, doc_id))

        for location in entities.get('locations', []):
            name = location.strip() if location else ''
            if len(name) > 1:
                location_names.add(name)
                relationships.append(('Location', name, doc_id))

    # Sort for consistent lock ordering (prevents deadlocks)
    people_list = sorted(list(people_names))
    org_list = sorted(list(org_names))
    location_list = sorted(list(location_names))

    with driver.session() as session:
        # Phase 1: Create documents (unique per batch, no contention)
        if documents:
            session.run("""
                UNWIND $docs AS doc
                MERGE (d:Document {doc_id: doc.doc_id})
                SET d.filename = doc.filename, d.source = doc.source, d.updated_at = datetime()
            """, docs=documents)

        # Phase 2: Create entities in sorted order (reduces deadlocks)
        # Use smaller sub-batches to reduce lock hold time
        ENTITY_BATCH_SIZE = 100

        for i in range(0, len(people_list), ENTITY_BATCH_SIZE):
            batch = [{'name': n} for n in people_list[i:i+ENTITY_BATCH_SIZE]]
            session.run("UNWIND $names AS n MERGE (:Person {name: n.name})", names=batch)

        for i in range(0, len(org_list), ENTITY_BATCH_SIZE):
            batch = [{'name': n} for n in org_list[i:i+ENTITY_BATCH_SIZE]]
            session.run("UNWIND $names AS n MERGE (:Organization {name: n.name})", names=batch)

        for i in range(0, len(location_list), ENTITY_BATCH_SIZE):
            batch = [{'name': n} for n in location_list[i:i+ENTITY_BATCH_SIZE]]
            session.run("UNWIND $names AS n MERGE (:Location {name: n.name})", names=batch)

        # Phase 3: Create relationships (entities already exist, just MATCH)
        # Group by entity type for efficiency
        person_rels = [{'name': r[1], 'doc_id': r[2]} for r in relationships if r[0] == 'Person']
        org_rels = [{'name': r[1], 'doc_id': r[2]} for r in relationships if r[0] == 'Organization']
        loc_rels = [{'name': r[1], 'doc_id': r[2]} for r in relationships if r[0] == 'Location']

        REL_BATCH_SIZE = 200

        for i in range(0, len(person_rels), REL_BATCH_SIZE):
            batch = person_rels[i:i+REL_BATCH_SIZE]
            session.run("""
                UNWIND $rels AS rel
                MATCH (p:Person {name: rel.name})
                MATCH (d:Document {doc_id: rel.doc_id})
                MERGE (p)-[:MENTIONED_IN]->(d)
            """, rels=batch)

        for i in range(0, len(org_rels), REL_BATCH_SIZE):
            batch = org_rels[i:i+REL_BATCH_SIZE]
            session.run("""
                UNWIND $rels AS rel
                MATCH (o:Organization {name: rel.name})
                MATCH (d:Document {doc_id: rel.doc_id})
                MERGE (o)-[:MENTIONED_IN]->(d)
            """, rels=batch)

        for i in range(0, len(loc_rels), REL_BATCH_SIZE):
            batch = loc_rels[i:i+REL_BATCH_SIZE]
            session.run("""
                UNWIND $rels AS rel
                MATCH (l:Location {name: rel.name})
                MATCH (d:Document {doc_id: rel.doc_id})
                MERGE (l)-[:MENTIONED_IN]->(d)
            """, rels=batch)


def claim_documents(conn, limit: int) -> list:
    """Claim documents for entity extraction using FOR UPDATE SKIP LOCKED."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            WITH claimed AS (
                SELECT id, filename, source, metadata
                FROM documents
                WHERE metadata->>'text' IS NOT NULL
                  AND LENGTH(metadata->>'text') > 100
                  AND (metadata->>'entities_extracted' IS NULL)
                  AND (metadata->>'entities_error' IS NULL)
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents d
            SET metadata = COALESCE(d.metadata, '{}'::jsonb) ||
                           jsonb_build_object('entities_started', NOW()::text, 'entity_worker_id', %s)
            FROM claimed c
            WHERE d.id = c.id
            RETURNING d.id, d.filename, d.source, d.metadata
        """, (limit, WORKER_ID))
        conn.commit()
        return cur.fetchall()


def update_document_status(conn, doc_id: str, entities: Dict[str, List[str]]):
    """Update document with extraction results."""
    with conn.cursor() as cur:
        metadata_update = {
            'entities_extracted': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'entity_worker_id': WORKER_ID,
            'entity_model': CEREBRAS_MODEL,
            'entity_counts': {
                'people': len(entities.get('people', [])),
                'organizations': len(entities.get('organizations', [])),
                'locations': len(entities.get('locations', []))
            }
        }
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
            WHERE id = %s
        """, (json.dumps(metadata_update), doc_id))


def mark_document_error(conn, doc_id: str, error: str):
    """Mark document with extraction error."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('entities_error', %s, 'entity_worker_id', %s)
            WHERE id = %s
        """, (error, WORKER_ID, doc_id))


def process_batch(conn, neo4j_driver) -> int:
    """Process a batch of documents for entity extraction with concurrent LLM calls."""
    documents = claim_documents(conn, BATCH_SIZE)

    if not documents:
        return 0

    logger.info(f"Processing batch of {len(documents)} documents with {CONCURRENT_REQUESTS} concurrent requests")

    # Use ThreadPoolExecutor for concurrent LLM API calls
    results = []
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
        futures = {executor.submit(process_single_doc, doc): doc for doc in documents}

        for future in as_completed(futures):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                doc = futures[future]
                logger.error(f"Error processing {doc['filename']}: {e}")
                results.append((str(doc['id']), doc['filename'], doc['source'], None, str(e)))

    extraction_time = time.time() - start_time
    logger.info(f"LLM extraction took {extraction_time:.1f}s for {len(documents)} docs ({len(documents)/extraction_time:.1f} docs/sec)")

    # Batch store all entities in Neo4j (async - don't block main loop)
    def neo4j_write_task():
        import random
        neo4j_start = time.time()
        max_retries = 5
        for attempt in range(max_retries):
            try:
                store_entities_neo4j_batch(neo4j_driver, results)
                neo4j_time = time.time() - neo4j_start
                logger.info(f"Neo4j batch write took {neo4j_time:.1f}s")
                return
            except Exception as e:
                error_str = str(e)
                is_deadlock = "DeadlockDetected" in error_str or "deadlock" in error_str.lower()
                is_lock_timeout = "LockClient" in error_str or "acquire" in error_str.lower()

                if (is_deadlock or is_lock_timeout) and attempt < max_retries - 1:
                    # Exponential backoff with random jitter to desync retries
                    base_delay = 0.5 * (2 ** attempt)
                    jitter = random.uniform(0, base_delay * 0.5)
                    delay = base_delay + jitter
                    logger.warning(f"Neo4j lock conflict, retry {attempt + 1}/{max_retries} in {delay:.1f}s")
                    time.sleep(delay)
                else:
                    logger.error(f"Neo4j batch error after {attempt + 1} attempts: {e}")
                    return

    # Run Neo4j write in background thread
    neo4j_thread = threading.Thread(target=neo4j_write_task, daemon=True)
    neo4j_thread.start()

    # Update PostgreSQL for all results
    processed = 0
    for doc_id, filename, source, entities, error in results:
        if error:
            mark_document_error(conn, doc_id, error)
            processed += 1
            continue

        total_entities = len(entities['people']) + len(entities['organizations']) + len(entities['locations'])
        if total_entities > 0:
            logger.info(f"Extracted from {filename}: {len(entities['people'])} people, {len(entities['organizations'])} orgs, {len(entities['locations'])} locations")
        else:
            logger.info(f"No entities found in {filename}")

        update_document_status(conn, doc_id, entities)
        processed += 1

    # Commit all PostgreSQL updates at once
    conn.commit()

    return processed


def get_stats(conn) -> dict:
    """Get extraction statistics."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
                COUNT(CASE WHEN metadata->>'entities_extracted' IS NOT NULL THEN 1 END) as entities_done,
                COUNT(CASE WHEN metadata->>'entities_error' IS NOT NULL THEN 1 END) as errors
            FROM documents
            WHERE filename LIKE '%%.pdf'
        """)
        return cur.fetchone()


def main():
    logger.info(f"Starting Entity Extractor Worker {WORKER_ID}")
    logger.info(f"Using Cerebras model: {CEREBRAS_MODEL}")
    logger.info(f"Batch size: {BATCH_SIZE}, Concurrent requests: {CONCURRENT_REQUESTS}")
    logger.info(f"Rate limit: {REQUESTS_PER_MINUTE} requests/min")

    if not CEREBRAS_API_KEY:
        logger.error("CEREBRAS_API_KEY not configured")
        sys.exit(1)

    conn = get_db_connection()
    neo4j_driver = get_neo4j_driver()

    # Create indexes
    create_neo4j_indexes(neo4j_driver)

    # Print initial stats
    stats = get_stats(conn)
    logger.info(f"Initial stats: {stats}")

    total_processed = 0
    consecutive_empty = 0

    while True:
        try:
            batch_start = time.time()
            processed = process_batch(conn, neo4j_driver)
            batch_time = time.time() - batch_start
            total_processed += processed

            if processed == 0:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    logger.info(f"No documents to process. Total: {total_processed}. Waiting 30s...")
                    time.sleep(30)
                else:
                    time.sleep(5)
            else:
                consecutive_empty = 0
                rate = processed / batch_time * 60 if batch_time > 0 else 0
                logger.info(f"Batch complete: {processed} docs in {batch_time:.1f}s ({rate:.0f}/min). Total: {total_processed}")

        except psycopg2.Error as e:
            logger.error(f"Database error: {e}")
            conn.close()
            time.sleep(10)
            conn = get_db_connection()

        except KeyboardInterrupt:
            logger.info("Shutting down...")
            break

        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            time.sleep(10)

    stats = get_stats(conn)
    logger.info(f"Final stats: {stats}")
    conn.close()
    neo4j_driver.close()


if __name__ == '__main__':
    main()
