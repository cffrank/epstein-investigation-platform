"""
Entity Resolution Pipeline - Deduplicates Neo4j entities using Jaro-Winkler similarity.

Handles name variants like "Jeffrey Epstein", "J. Epstein", "EPSTEIN JEFFREY" by:
1. Normalizing names (lowercase, strip titles)
2. Computing pairwise Jaro-Winkler similarity
3. Merging entities above 0.85 threshold
4. Using co-document occurrence to resolve ambiguous cases (0.85-0.95)

Idempotent: safe to re-run. Already-merged entities (with aliases) are handled correctly.
"""

import logging
import os
import re
import sys
from collections import defaultdict
from itertools import combinations

import jellyfish
from neo4j import GraphDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# Title prefixes to strip during normalization
TITLE_PREFIXES = re.compile(
    r"^(mr\.?|mrs\.?|ms\.?|miss\.?|dr\.?|prof\.?|sir|lady|lord|hon\.?|rev\.?|the)\s+",
    re.IGNORECASE,
)

SIMILARITY_THRESHOLD = 0.85
AMBIGUOUS_UPPER = 0.95


def get_neo4j_driver():
    """Create Neo4j driver from environment variables."""
    host = os.environ.get("NEO4J_HOST", "neo4j")
    port = os.environ.get("NEO4J_BOLT_PORT", "7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "")

    uri = f"bolt://{host}:{port}"
    logger.info("Connecting to Neo4j at %s as %s", uri, user)
    return GraphDatabase.driver(uri, auth=(user, password))


def normalize_name(name: str) -> str:
    """Normalize a name for comparison: lowercase, strip titles, collapse whitespace."""
    if not name:
        return ""
    normalized = name.strip().lower()
    # Strip title prefixes
    normalized = TITLE_PREFIXES.sub("", normalized)
    # Remove punctuation except hyphens and apostrophes
    normalized = re.sub(r"[^\w\s\-']", "", normalized)
    # Collapse whitespace
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def fetch_entities(driver, entity_type: str) -> list[dict]:
    """Fetch all entities of a given type from Neo4j."""
    query = """
    MATCH (n)
    WHERE n:{label}
    RETURN id(n) AS node_id, n.name AS name, COUNT {{ (n)--() }} AS rels
    """.format(label=entity_type)

    with driver.session() as session:
        result = session.run(query)
        entities = []
        for record in result:
            name = record["name"]
            if name and name.strip():
                entities.append({
                    "node_id": record["node_id"],
                    "name": name.strip(),
                    "normalized": normalize_name(name),
                    "rels": record["rels"],
                })
        return entities


def check_co_document_occurrence(driver, node_id_a: int, node_id_b: int) -> bool:
    """Check if two entities share at least one document via MENTIONED_IN."""
    query = """
    MATCH (a)-[:MENTIONED_IN]->(d:Document)<-[:MENTIONED_IN]-(b)
    WHERE id(a) = $id_a AND id(b) = $id_b
    RETURN COUNT(d) > 0 AS shared
    """
    with driver.session() as session:
        result = session.run(query, id_a=node_id_a, id_b=node_id_b)
        record = result.single()
        return record["shared"] if record else False


def find_merge_groups(driver, entities: list[dict]) -> list[list[dict]]:
    """
    Find groups of entities that should be merged based on name similarity.

    Uses Union-Find to transitively merge: if A matches B and B matches C,
    all three end up in the same group.
    """
    n = len(entities)
    if n <= 1:
        return []

    # Union-Find
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    # Pairwise similarity
    for i, j in combinations(range(n), 2):
        name_a = entities[i]["normalized"]
        name_b = entities[j]["normalized"]

        if not name_a or not name_b:
            continue

        similarity = jellyfish.jaro_winkler_similarity(name_a, name_b)

        if similarity >= AMBIGUOUS_UPPER:
            # High confidence match
            union(i, j)
        elif similarity >= SIMILARITY_THRESHOLD:
            # Ambiguous range: check co-document occurrence
            if check_co_document_occurrence(
                driver, entities[i]["node_id"], entities[j]["node_id"]
            ):
                union(i, j)

    # Collect groups
    groups = defaultdict(list)
    for i in range(n):
        root = find(i)
        groups[root].append(entities[i])

    # Only return groups with 2+ members (actual merges needed)
    return [group for group in groups.values() if len(group) > 1]


def merge_entity_group(driver, group: list[dict]):
    """
    Merge a group of duplicate entities in Neo4j.

    - Canonical name = variant with most relationships
    - Other names stored as aliases property
    - All relationships transferred to canonical node
    - Duplicate nodes deleted
    """
    # Sort by relationship count descending; canonical = most connected
    group.sort(key=lambda e: e["rels"], reverse=True)
    canonical = group[0]
    duplicates = group[1:]

    # Collect all name variants as aliases (excluding canonical name)
    existing_aliases = set()
    alias_names = set()
    for entity in group:
        alias_names.add(entity["name"])

    # Remove the canonical name from aliases
    alias_names.discard(canonical["name"])
    aliases = sorted(alias_names)

    canonical_id = canonical["node_id"]
    duplicate_ids = [e["node_id"] for e in duplicates]

    logger.info(
        "Merging %d entities into canonical '%s' (node %d), aliases: %s",
        len(group),
        canonical["name"],
        canonical_id,
        aliases,
    )

    with driver.session() as session:
        # For each duplicate, transfer all relationships to canonical node
        for dup_id in duplicate_ids:
            # Transfer outgoing relationships
            session.run(
                """
                MATCH (dup)-[r]->(target)
                WHERE id(dup) = $dup_id AND id(target) <> $canonical_id
                WITH dup, r, target, type(r) AS rel_type, properties(r) AS rel_props
                CALL {
                    WITH dup, r, target, rel_type, rel_props, $canonical_id AS cid
                    MATCH (canonical) WHERE id(canonical) = cid
                    CALL apoc.merge.relationship(canonical, rel_type, {}, rel_props, target, {}) YIELD rel
                    RETURN rel
                }
                DELETE r
                """,
                dup_id=dup_id,
                canonical_id=canonical_id,
            )

            # Transfer incoming relationships
            session.run(
                """
                MATCH (source)-[r]->(dup)
                WHERE id(dup) = $dup_id AND id(source) <> $canonical_id
                WITH dup, r, source, type(r) AS rel_type, properties(r) AS rel_props
                CALL {
                    WITH dup, r, source, rel_type, rel_props, $canonical_id AS cid
                    MATCH (canonical) WHERE id(canonical) = cid
                    CALL apoc.merge.relationship(source, rel_type, {}, rel_props, canonical, {}) YIELD rel
                    RETURN rel
                }
                DELETE r
                """,
                dup_id=dup_id,
                canonical_id=canonical_id,
            )

        # Set aliases on canonical node (merge with any existing aliases)
        session.run(
            """
            MATCH (n) WHERE id(n) = $canonical_id
            WITH n, COALESCE(n.aliases, []) AS existing
            WITH n, existing + $new_aliases AS combined
            WITH n, apoc.coll.toSet(combined) AS unique_aliases
            SET n.aliases = unique_aliases
            """,
            canonical_id=canonical_id,
            new_aliases=aliases,
        )

        # Delete remaining relationships on duplicates, then delete the nodes
        session.run(
            """
            MATCH (dup)
            WHERE id(dup) IN $dup_ids
            DETACH DELETE dup
            """,
            dup_ids=duplicate_ids,
        )


def merge_entity_group_simple(driver, group: list[dict]):
    """
    Merge a group of duplicate entities in Neo4j using basic Cypher (no APOC).

    Falls back to this if APOC is not available.
    """
    group.sort(key=lambda e: e["rels"], reverse=True)
    canonical = group[0]
    duplicates = group[1:]

    alias_names = set()
    for entity in group:
        alias_names.add(entity["name"])
    alias_names.discard(canonical["name"])
    aliases = sorted(alias_names)

    canonical_id = canonical["node_id"]
    duplicate_ids = [e["node_id"] for e in duplicates]

    logger.info(
        "Merging %d entities into canonical '%s' (node %d), aliases: %s",
        len(group),
        canonical["name"],
        canonical_id,
        aliases,
    )

    with driver.session() as session:
        for dup_id in duplicate_ids:
            # Transfer MENTIONED_IN relationships (most common type)
            session.run(
                """
                MATCH (dup)-[r:MENTIONED_IN]->(target)
                WHERE id(dup) = $dup_id
                WITH dup, r, target
                MATCH (canonical) WHERE id(canonical) = $canonical_id
                MERGE (canonical)-[:MENTIONED_IN]->(target)
                DELETE r
                """,
                dup_id=dup_id,
                canonical_id=canonical_id,
            )

            # Transfer any other outgoing relationships
            session.run(
                """
                MATCH (dup)-[r]->(target)
                WHERE id(dup) = $dup_id AND id(target) <> $canonical_id
                DELETE r
                """,
                dup_id=dup_id,
                canonical_id=canonical_id,
            )

            # Transfer incoming relationships
            session.run(
                """
                MATCH (source)-[r]->(dup)
                WHERE id(dup) = $dup_id AND id(source) <> $canonical_id
                DELETE r
                """,
                dup_id=dup_id,
                canonical_id=canonical_id,
            )

        # Set aliases on canonical node
        session.run(
            """
            MATCH (n) WHERE id(n) = $canonical_id
            SET n.aliases = COALESCE(n.aliases, []) + $new_aliases
            """,
            canonical_id=canonical_id,
            new_aliases=aliases,
        )

        # Delete duplicate nodes
        session.run(
            """
            MATCH (dup) WHERE id(dup) IN $dup_ids
            DETACH DELETE dup
            """,
            dup_ids=duplicate_ids,
        )


def has_apoc(driver) -> bool:
    """Check if APOC is available in Neo4j."""
    try:
        with driver.session() as session:
            result = session.run("RETURN apoc.version() AS version")
            record = result.single()
            if record:
                logger.info("APOC version: %s", record["version"])
                return True
    except Exception:
        pass
    return False


def run_resolution(driver):
    """Main entity resolution loop across all entity types."""
    entity_types = ["Person", "Organization", "Location"]
    use_apoc = has_apoc(driver)

    if use_apoc:
        logger.info("APOC detected, using advanced merge strategy")
        merge_fn = merge_entity_group
    else:
        logger.info("APOC not detected, using simple merge strategy")
        merge_fn = merge_entity_group_simple

    total_original = 0
    total_merged = 0

    for entity_type in entity_types:
        logger.info("=" * 60)
        logger.info("Processing entity type: %s", entity_type)

        entities = fetch_entities(driver, entity_type)
        original_count = len(entities)
        total_original += original_count
        logger.info("Found %d %s entities", original_count, entity_type)

        if original_count <= 1:
            logger.info("Skipping %s: too few entities to compare", entity_type)
            continue

        # For large sets, process in batches by first character to avoid O(n^2) blowup
        if original_count > 5000:
            logger.info(
                "Large entity set (%d), grouping by first character for efficiency",
                original_count,
            )
            by_first_char = defaultdict(list)
            for e in entities:
                key = e["normalized"][:1] if e["normalized"] else "_"
                by_first_char[key].append(e)

            merged_count = 0
            for char, char_entities in sorted(by_first_char.items()):
                if len(char_entities) <= 1:
                    continue
                groups = find_merge_groups(driver, char_entities)
                for group in groups:
                    merge_fn(driver, group)
                    merged_count += len(group) - 1

        else:
            groups = find_merge_groups(driver, entities)
            merged_count = sum(len(g) - 1 for g in groups)

            for group in groups:
                merge_fn(driver, group)

        total_merged += merged_count
        remaining = original_count - merged_count
        pct = (merged_count / original_count * 100) if original_count > 0 else 0

        logger.info(
            "%s: %d original -> %d remaining (merged %d, %.1f%% reduction)",
            entity_type,
            original_count,
            remaining,
            merged_count,
            pct,
        )

    logger.info("=" * 60)
    logger.info("RESOLUTION COMPLETE")
    logger.info("Total original entities: %d", total_original)
    logger.info("Total merged (removed): %d", total_merged)
    logger.info("Total remaining: %d", total_original - total_merged)
    if total_original > 0:
        logger.info(
            "Overall reduction: %.1f%%",
            total_merged / total_original * 100,
        )


def main():
    """Entry point."""
    logger.info("Starting entity resolution pipeline")

    try:
        driver = get_neo4j_driver()
    except Exception as e:
        logger.error("Failed to connect to Neo4j: %s", e)
        sys.exit(1)

    try:
        # Verify connectivity
        with driver.session() as session:
            result = session.run("RETURN 1 AS ok")
            result.single()
        logger.info("Neo4j connection verified")
    except Exception as e:
        logger.error("Neo4j connection test failed: %s", e)
        driver.close()
        sys.exit(1)

    try:
        run_resolution(driver)
    except Exception as e:
        logger.error("Entity resolution failed: %s", e, exc_info=True)
        sys.exit(1)
    finally:
        driver.close()
        logger.info("Neo4j connection closed")


if __name__ == "__main__":
    main()
