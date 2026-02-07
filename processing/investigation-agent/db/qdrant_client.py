"""Qdrant vector search client for the investigation agent.

Searches across three collections:
  - document_embeddings_v2: OpenAI 1536d embeddings of document text (1.6M+ vectors)
  - document_embeddings: BGE 768d embeddings of document text (91K vectors)
  - vlm_analysis: OpenAI 1536d embeddings of VLM-extracted OCR text + people descriptions (12K+ vectors)
"""

import logging
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as http_requests
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

from config import (
    QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY,
    QDRANT_COLLECTION, QDRANT_COLLECTION_V1, QDRANT_COLLECTION_VLM
)

logger = logging.getLogger(__name__)


def _http_headers():
    headers = {}
    if QDRANT_API_KEY:
        headers['api-key'] = QDRANT_API_KEY
    return headers


class QdrantSearchClient:
    def __init__(self):
        self.client = QdrantClient(
            host=QDRANT_HOST, port=QDRANT_PORT,
            api_key=QDRANT_API_KEY if QDRANT_API_KEY else None,
            https=False
        )
        self.collection_v2 = QDRANT_COLLECTION      # 1536d OpenAI - primary
        self.collection_v1 = QDRANT_COLLECTION_V1    # 768d BGE - legacy
        self.collection_vlm = QDRANT_COLLECTION_VLM  # 1536d OpenAI - VLM analysis

    def search_by_vector(self, vector: List[float], limit: int = 20,
                         source_filter: str = None,
                         collection: str = None) -> List[Dict]:
        """Search by pre-computed embedding vector in a specific collection."""
        coll = collection or self.collection_v2
        query_filter = None
        if source_filter:
            query_filter = Filter(must=[
                FieldCondition(key="source", match=MatchValue(value=source_filter))
            ])

        results = self.client.search(
            collection_name=coll,
            query_vector=vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=True
        )

        return [self._format_result(r, coll) for r in results]

    def search_all_collections(self, vector_1536: List[float],
                               vector_768: List[float] = None,
                               limit: int = 20,
                               source_filter: str = None) -> Dict:
        """Search across all collections in parallel. Returns results grouped by source.

        Args:
            vector_1536: 1536-dim OpenAI embedding (searches v2 + vlm)
            vector_768: 768-dim BGE embedding (searches v1). Optional.
            limit: results per collection
            source_filter: filter by source dataset
        """
        results = {'v2': [], 'vlm': [], 'v1': []}

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(
                    self.search_by_vector, vector_1536, limit, source_filter, self.collection_v2
                ): 'v2',
                executor.submit(
                    self.search_by_vector, vector_1536, limit, source_filter, self.collection_vlm
                ): 'vlm',
            }
            if vector_768:
                futures[executor.submit(
                    self.search_by_vector, vector_768, limit, source_filter, self.collection_v1
                )] = 'v1'

            for future in as_completed(futures):
                key = futures[future]
                try:
                    results[key] = future.result()
                except Exception as e:
                    logger.warning(f"Search failed for {key}: {e}")

        # Merge and deduplicate by document_id, keeping highest score
        seen = {}
        for source_key in ['v2', 'vlm', 'v1']:
            for doc in results[source_key]:
                doc_id = doc.get('document_id')
                if not doc_id:
                    continue
                existing = seen.get(doc_id)
                if not existing or doc['score'] > existing['score']:
                    doc['collection'] = source_key
                    seen[doc_id] = doc

        merged = sorted(seen.values(), key=lambda x: x['score'], reverse=True)[:limit]
        results['merged'] = merged
        results['total_unique'] = len(seen)
        return results

    def search_vlm(self, vector: List[float], limit: int = 20,
                   embedding_type: str = None) -> List[Dict]:
        """Search VLM analysis collection specifically.

        Args:
            vector: 1536-dim embedding vector
            embedding_type: filter by 'people', 'ocr_text', etc.
        """
        query_filter = None
        if embedding_type:
            query_filter = Filter(must=[
                FieldCondition(key="embedding_type", match=MatchValue(value=embedding_type))
            ])

        results = self.client.search(
            collection_name=self.collection_vlm,
            query_vector=vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=True
        )

        return [self._format_vlm_result(r) for r in results]

    def find_similar(self, point_id: int, limit: int = 20,
                     collection: str = None) -> List[Dict]:
        """Find points similar to a given point ID."""
        coll = collection or self.collection_v2
        try:
            results = self.client.recommend(
                collection_name=coll,
                positive=[point_id],
                limit=limit,
                with_payload=True
            )
            return [self._format_result(r, coll) for r in results]
        except Exception as e:
            logger.warning(f"Similarity search failed: {e}")
            return []

    def get_collection_info(self, collection: str = None) -> Dict:
        """Get collection statistics via raw HTTP."""
        coll = collection or self.collection_v2
        resp = http_requests.get(
            f"http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{coll}",
            headers=_http_headers(), timeout=10
        )
        resp.raise_for_status()
        result = resp.json().get('result', {})
        return {
            'collection': coll,
            'points_count': result.get('points_count', 0),
            'indexed_vectors_count': result.get('indexed_vectors_count', 0),
            'segments_count': result.get('segments_count', 0),
        }

    def get_all_collections_info(self) -> Dict:
        """Get stats for all three collections."""
        info = {}
        for name, coll in [('v2', self.collection_v2), ('v1', self.collection_v1),
                            ('vlm', self.collection_vlm)]:
            try:
                info[name] = self.get_collection_info(coll)
            except Exception as e:
                info[name] = {'collection': coll, 'error': str(e)}
        return info

    def _format_result(self, r, collection: str) -> Dict:
        """Format a document embedding result."""
        return {
            'id': str(r.id),
            'score': r.score,
            'collection': collection,
            'document_id': r.payload.get('document_id'),
            'filename': r.payload.get('filename'),
            'source': r.payload.get('source'),
            'chunk_index': r.payload.get('chunk_index'),
            'total_chunks': r.payload.get('total_chunks'),
            'text_preview': r.payload.get('text_preview', ''),
        }

    def _format_vlm_result(self, r) -> Dict:
        """Format a VLM analysis result with people/OCR data."""
        payload = r.payload
        people = payload.get('people', [])
        doc_type = payload.get('document_type', {})

        # Build a text preview from VLM data
        preview_parts = []
        if isinstance(doc_type, dict) and doc_type.get('type'):
            preview_parts.append(f"[{doc_type['type']}]")
        for p in people[:3]:
            if isinstance(p, dict):
                desc = p.get('description', '')
                activity = p.get('activity', '')
                if desc:
                    preview_parts.append(desc[:200])
                if activity:
                    preview_parts.append(f"Activity: {activity[:100]}")

        return {
            'id': str(r.id),
            'score': r.score,
            'collection': 'vlm_analysis',
            'document_id': payload.get('document_id'),
            'filename': payload.get('filename'),
            'source': payload.get('source'),
            'embedding_type': payload.get('embedding_type'),
            'people_count': payload.get('people_count', 0),
            'people': people,
            'document_type': doc_type,
            'vlm_confidence': payload.get('vlm_confidence'),
            'text_preview': ' | '.join(preview_parts) if preview_parts else '',
        }

    def close(self):
        self.client.close()
