"""Unified multi-database query orchestrator."""

import logging
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from db.postgres import PostgresClient
from db.qdrant_client import QdrantSearchClient
from db.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)


class UnifiedSearch:
    def __init__(self, pg: PostgresClient, qdrant: QdrantSearchClient, neo4j: Neo4jClient):
        self.pg = pg
        self.qdrant = qdrant
        self.neo4j = neo4j

    def search_person(self, name: str, limit: int = 50) -> Dict:
        """Cross-database person search: Neo4j entities + PG documents."""
        results = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(self.neo4j.get_entity, name, 'Person'): 'neo4j_entities',
                executor.submit(self.neo4j.get_connections, name, 2, 30): 'connections',
                executor.submit(self.pg.search_documents_by_person, name, limit): 'documents',
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    results[key] = future.result()
                except Exception as e:
                    logger.error(f"{key} search failed: {e}")
                    results[key] = []

        results['document_count'] = len(results.get('documents', []))
        results['connection_count'] = len(results.get('connections', []))
        return results

    def find_connections(self, entity_a: str, entity_b: str) -> Dict:
        """Find connections between two entities via Neo4j paths and PG co-occurrence."""
        results = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(self.neo4j.shortest_path, entity_a, entity_b): 'paths',
                executor.submit(self.neo4j.co_mentioned_entities, entity_a, 20): 'a_connections',
                executor.submit(self.neo4j.co_mentioned_entities, entity_b, 20): 'b_connections',
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    results[key] = future.result()
                except Exception as e:
                    logger.error(f"{key} failed: {e}")
                    results[key] = []

        # Find shared connections
        a_names = {c['name'] for c in results.get('a_connections', [])}
        b_names = {c['name'] for c in results.get('b_connections', [])}
        results['shared_connections'] = list(a_names & b_names)

        return results

    def search_documents(self, query: str, embedding_vector: List[float] = None,
                          limit: int = 30) -> Dict:
        """Combined semantic (v2 + VLM) + fulltext search, merged and re-ranked."""
        results = {'fulltext': [], 'semantic_v2': [], 'semantic_vlm': []}

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(self.pg.search_fulltext, query, limit): 'fulltext',
            }
            if embedding_vector:
                futures[executor.submit(
                    self.qdrant.search_by_vector, embedding_vector, limit, None, self.qdrant.collection_v2
                )] = 'semantic_v2'
                futures[executor.submit(
                    self.qdrant.search_by_vector, embedding_vector, limit, None, self.qdrant.collection_vlm
                )] = 'semantic_vlm'

            for future in as_completed(futures):
                key = futures[future]
                try:
                    results[key] = future.result()
                except Exception as e:
                    logger.error(f"{key} search failed: {e}")

        # Merge and deduplicate by document_id
        seen_ids = set()
        merged = []
        for doc in results['semantic_v2']:
            doc_id = doc.get('document_id')
            if doc_id and doc_id not in seen_ids:
                seen_ids.add(doc_id)
                merged.append({**doc, 'search_type': 'semantic_v2'})

        for doc in results['semantic_vlm']:
            doc_id = doc.get('document_id')
            if doc_id and doc_id not in seen_ids:
                seen_ids.add(doc_id)
                merged.append({**doc, 'search_type': 'semantic_vlm'})

        for doc in results['fulltext']:
            doc_id = str(doc.get('id', ''))
            if doc_id not in seen_ids:
                seen_ids.add(doc_id)
                merged.append({**doc, 'search_type': 'fulltext'})

        results['merged'] = merged[:limit]
        results['total_unique'] = len(merged)
        return results

    def get_entity_network(self, name: str, depth: int = 2) -> Dict:
        """Get Neo4j entity graph enriched with document counts."""
        connections = self.neo4j.get_connections(name, depth)
        doc_count = self.neo4j.get_entity_document_count(name)

        return {
            'entity': name,
            'document_count': doc_count,
            'connections': connections,
            'connection_count': len(connections),
        }

    def get_platform_stats(self) -> Dict:
        """Get statistics from all databases including all Qdrant collections."""
        stats = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(self.pg.get_document_stats): 'postgres',
                executor.submit(self.neo4j.get_entity_stats): 'neo4j_entities',
                executor.submit(self.qdrant.get_all_collections_info): 'qdrant',
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    stats[key] = future.result()
                except Exception as e:
                    logger.error(f"{key} stats failed: {e}")
                    stats[key] = {'error': str(e)}

        return stats
