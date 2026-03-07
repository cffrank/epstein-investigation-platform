"""
Sync resolved entities from Neo4j to PostgreSQL.

After entity resolution (resolve.py), this script:
1. Reads canonical entities from Neo4j
2. Upserts them into PostgreSQL entities table
3. Reads MENTIONED_IN relationships from Neo4j
4. Upserts them into PostgreSQL document_entities table

Idempotent: safe to re-run. Uses ON CONFLICT for upserts.
"""

import logging
import os
import sys

import psycopg2
import psycopg2.extras
from neo4j import GraphDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def get_neo4j_driver():
    """Create Neo4j driver from environment variables."""
    host = os.environ.get("NEO4J_HOST", "neo4j")
    port = os.environ.get("NEO4J_BOLT_PORT", "7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "")

    uri = f"bolt://{host}:{port}"
    logger.info("Connecting to Neo4j at %s as %s", uri, user)
    return GraphDatabase.driver(uri, auth=(user, password))


def get_pg_connection():
    """Create PostgreSQL connection from environment variables."""
    host = os.environ.get("PG_HOST", "postgres")
    port = os.environ.get("PG_PORT", "5432")
    database = os.environ.get("PG_DATABASE", "platform")
    user = os.environ.get("PG_USER", "investigation")
    password = os.environ.get("PG_PASSWORD", "")

    logger.info("Connecting to PostgreSQL at %s:%s/%s as %s", host, port, database, user)
    return psycopg2.connect(
        host=host,
        port=int(port),
        dbname=database,
        user=user,
        password=password,
    )


def fetch_canonical_entities(driver) -> list[dict]:
    """Fetch all canonical entities from Neo4j."""
    query = """
    MATCH (n)
    WHERE n:Person OR n:Organization OR n:Location
    RETURN id(n) AS node_id,
           labels(n)[0] AS label,
           n.name AS name,
           COALESCE(n.aliases, []) AS aliases
    """
    with driver.session() as session:
        result = session.run(query)
        entities = []
        for record in result:
            name = record["name"]
            if name and name.strip():
                entities.append({
                    "node_id": record["node_id"],
                    "label": record["label"],
                    "name": name.strip(),
                    "aliases": list(record["aliases"]),
                })
        return entities


def fetch_document_relationships(driver) -> list[dict]:
    """Fetch MENTIONED_IN relationships from Neo4j."""
    query = """
    MATCH (n)-[r:MENTIONED_IN]->(d:Document)
    WHERE (n:Person OR n:Organization OR n:Location) AND d.id IS NOT NULL
    RETURN n.name AS name,
           labels(n)[0] AS label,
           d.id AS doc_id,
           COALESCE(r.count, 1) AS mention_count
    """
    with driver.session() as session:
        result = session.run(query)
        relationships = []
        for record in result:
            name = record["name"]
            doc_id = record["doc_id"]
            if name and name.strip() and doc_id:
                relationships.append({
                    "name": name.strip(),
                    "label": record["label"],
                    "doc_id": str(doc_id),
                    "mention_count": record["mention_count"],
                })
        return relationships


def upsert_entities(pg_conn, entities: list[dict]) -> dict[tuple[str, str], int]:
    """
    Upsert entities into PostgreSQL entities table.

    Returns a mapping of (entity_type, canonical_name) -> entity_id for
    use when upserting document_entities.
    """
    if not entities:
        logger.info("No entities to upsert")
        return {}

    entity_map = {}

    upsert_sql = """
    INSERT INTO entities (entity_type, canonical_name, aliases)
    VALUES (%s, %s, %s)
    ON CONFLICT (entity_type, canonical_name)
    DO UPDATE SET aliases = EXCLUDED.aliases
    RETURNING id
    """

    cursor = pg_conn.cursor()
    upserted = 0

    for entity in entities:
        entity_type = entity["label"].lower()
        canonical_name = entity["name"]
        aliases = entity["aliases"]

        try:
            cursor.execute(
                upsert_sql,
                (entity_type, canonical_name, aliases),
            )
            row = cursor.fetchone()
            if row:
                entity_id = row[0]
                entity_map[(entity_type, canonical_name)] = entity_id
                upserted += 1
        except Exception as e:
            logger.warning(
                "Failed to upsert entity '%s' (%s): %s",
                canonical_name,
                entity_type,
                e,
            )
            pg_conn.rollback()
            cursor = pg_conn.cursor()
            continue

    pg_conn.commit()
    cursor.close()
    logger.info("Upserted %d entities into PostgreSQL", upserted)
    return entity_map


def upsert_document_entities(
    pg_conn,
    relationships: list[dict],
    entity_map: dict[tuple[str, str], int],
):
    """Upsert document-entity relationships into PostgreSQL document_entities table."""
    if not relationships:
        logger.info("No document-entity relationships to upsert")
        return

    upsert_sql = """
    INSERT INTO document_entities (document_id, entity_id, mention_count)
    VALUES (%s, %s, %s)
    ON CONFLICT (document_id, entity_id)
    DO UPDATE SET mention_count = EXCLUDED.mention_count
    """

    cursor = pg_conn.cursor()
    upserted = 0
    skipped = 0

    for rel in relationships:
        entity_type = rel["label"].lower()
        name = rel["name"]
        doc_id = rel["doc_id"]
        mention_count = rel["mention_count"]

        entity_id = entity_map.get((entity_type, name))
        if entity_id is None:
            skipped += 1
            continue

        try:
            cursor.execute(upsert_sql, (doc_id, entity_id, mention_count))
            upserted += 1
        except Exception as e:
            # Foreign key violations are expected for documents not yet in PG
            pg_conn.rollback()
            cursor = pg_conn.cursor()
            skipped += 1
            continue

        # Commit in batches for performance
        if upserted % 5000 == 0:
            pg_conn.commit()

    pg_conn.commit()
    cursor.close()
    logger.info(
        "Upserted %d document-entity relationships (%d skipped)",
        upserted,
        skipped,
    )


def main():
    """Entry point for Neo4j -> PostgreSQL entity sync."""
    logger.info("Starting entity sync: Neo4j -> PostgreSQL")

    # Connect to Neo4j
    try:
        neo4j_driver = get_neo4j_driver()
        with neo4j_driver.session() as session:
            session.run("RETURN 1 AS ok").single()
        logger.info("Neo4j connection verified")
    except Exception as e:
        logger.error("Failed to connect to Neo4j: %s", e)
        sys.exit(1)

    # Connect to PostgreSQL
    try:
        pg_conn = get_pg_connection()
        cursor = pg_conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        logger.info("PostgreSQL connection verified")
    except Exception as e:
        logger.error("Failed to connect to PostgreSQL: %s", e)
        neo4j_driver.close()
        sys.exit(1)

    try:
        # Step 1: Fetch and upsert entities
        logger.info("Fetching canonical entities from Neo4j...")
        entities = fetch_canonical_entities(neo4j_driver)
        logger.info("Found %d canonical entities", len(entities))

        entity_map = upsert_entities(pg_conn, entities)

        # Step 2: Fetch and upsert document relationships
        logger.info("Fetching MENTIONED_IN relationships from Neo4j...")
        relationships = fetch_document_relationships(neo4j_driver)
        logger.info("Found %d document-entity relationships", len(relationships))

        upsert_document_entities(pg_conn, relationships, entity_map)

        logger.info("Entity sync complete")

    except Exception as e:
        logger.error("Entity sync failed: %s", e, exc_info=True)
        sys.exit(1)
    finally:
        neo4j_driver.close()
        pg_conn.close()
        logger.info("Connections closed")


if __name__ == "__main__":
    main()
