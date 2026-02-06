"""Neo4j graph database client for the investigation agent."""

import logging
from typing import List, Dict, Optional

from neo4j import GraphDatabase

from config import NEO4J_HOST, NEO4J_BOLT_PORT, NEO4J_USER, NEO4J_PASSWORD

logger = logging.getLogger(__name__)


class Neo4jClient:
    def __init__(self):
        uri = f"bolt://{NEO4J_HOST}:{NEO4J_BOLT_PORT}"
        self.driver = GraphDatabase.driver(uri, auth=(NEO4J_USER, NEO4J_PASSWORD))

    def _run(self, query: str, **params) -> List[Dict]:
        with self.driver.session() as session:
            result = session.run(query, **params)
            return [dict(record) for record in result]

    def get_entity(self, name: str, entity_type: str = None) -> List[Dict]:
        """Find entity nodes matching a name (case-insensitive partial match)."""
        if entity_type:
            return self._run("""
                MATCH (e) WHERE labels(e)[0] = $type AND toLower(e.name) CONTAINS toLower($name)
                RETURN labels(e)[0] as type, e.name as name, id(e) as node_id
                LIMIT 20
            """, name=name, type=entity_type)
        return self._run("""
            MATCH (e) WHERE (e:Person OR e:Organization OR e:Location)
              AND toLower(e.name) CONTAINS toLower($name)
            RETURN labels(e)[0] as type, e.name as name, id(e) as node_id
            LIMIT 20
        """, name=name)

    def get_connections(self, name: str, depth: int = 2, limit: int = 50) -> List[Dict]:
        """Get entities connected to a given entity within N hops."""
        return self._run("""
            MATCH (start)-[:MENTIONED_IN]->(d:Document)<-[:MENTIONED_IN]-(connected)
            WHERE toLower(start.name) CONTAINS toLower($name)
              AND start <> connected
            WITH connected, COUNT(DISTINCT d) as shared_docs
            ORDER BY shared_docs DESC
            LIMIT $limit
            RETURN labels(connected)[0] as type, connected.name as name, shared_docs
        """, name=name, limit=limit)

    def shortest_path(self, entity_a: str, entity_b: str) -> List[Dict]:
        """Find shortest path between two entities via shared documents."""
        return self._run("""
            MATCH (a), (b)
            WHERE toLower(a.name) CONTAINS toLower($a) AND toLower(b.name) CONTAINS toLower($b)
            WITH a, b LIMIT 1
            MATCH path = shortestPath((a)-[:MENTIONED_IN*..6]-(b))
            RETURN [n IN nodes(path) | {name: n.name, labels: labels(n), doc_id: n.doc_id}] as path_nodes,
                   length(path) as path_length
            LIMIT 5
        """, a=entity_a, b=entity_b)

    def co_mentioned_entities(self, entity_name: str, limit: int = 30) -> List[Dict]:
        """Find entities frequently co-mentioned in same documents."""
        return self._run("""
            MATCH (e)-[:MENTIONED_IN]->(d:Document)<-[:MENTIONED_IN]-(other)
            WHERE toLower(e.name) CONTAINS toLower($name) AND e <> other
            WITH other, COUNT(DISTINCT d) as co_mentions, COLLECT(DISTINCT d.doc_id)[..5] as sample_docs
            ORDER BY co_mentions DESC
            LIMIT $limit
            RETURN labels(other)[0] as type, other.name as name, co_mentions, sample_docs
        """, name=entity_name, limit=limit)

    def get_entity_document_count(self, name: str) -> int:
        """Get number of documents mentioning an entity."""
        rows = self._run("""
            MATCH (e)-[:MENTIONED_IN]->(d:Document)
            WHERE toLower(e.name) CONTAINS toLower($name)
            RETURN COUNT(DISTINCT d) as doc_count
        """, name=name)
        return rows[0]['doc_count'] if rows else 0

    def get_entity_stats(self) -> Dict:
        """Get counts of entity types."""
        rows = self._run("""
            MATCH (n) WHERE n:Person OR n:Organization OR n:Location OR n:Document
            RETURN labels(n)[0] as label, COUNT(n) as count
        """)
        return {r['label']: r['count'] for r in rows}

    def get_relationship_stats(self) -> Dict:
        """Get relationship type counts."""
        rows = self._run("""
            MATCH ()-[r]->() RETURN type(r) as rel_type, COUNT(r) as count
        """)
        return {r['rel_type']: r['count'] for r in rows}

    def find_hub_entities(self, entity_type: str = 'Person', limit: int = 20) -> List[Dict]:
        """Find entities with most document connections (hubs)."""
        return self._run("""
            MATCH (e)-[:MENTIONED_IN]->(d:Document)
            WHERE labels(e)[0] = $type
            WITH e, COUNT(DISTINCT d) as doc_count
            ORDER BY doc_count DESC
            LIMIT $limit
            RETURN e.name as name, doc_count
        """, type=entity_type, limit=limit)

    def close(self):
        self.driver.close()
