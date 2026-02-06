"""Qdrant vector search client for the investigation agent."""

import logging
from typing import List, Dict, Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

from config import QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY, QDRANT_COLLECTION

logger = logging.getLogger(__name__)


class QdrantSearchClient:
    def __init__(self):
        self.client = QdrantClient(
            host=QDRANT_HOST, port=QDRANT_PORT,
            api_key=QDRANT_API_KEY if QDRANT_API_KEY else None,
            https=False
        )
        self.collection = QDRANT_COLLECTION

    def search_by_vector(self, vector: List[float], limit: int = 20,
                         source_filter: str = None) -> List[Dict]:
        """Search by pre-computed embedding vector."""
        query_filter = None
        if source_filter:
            query_filter = Filter(must=[
                FieldCondition(key="source", match=MatchValue(value=source_filter))
            ])

        results = self.client.search(
            collection_name=self.collection,
            query_vector=vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=True
        )

        return [
            {
                'id': str(r.id),
                'score': r.score,
                'document_id': r.payload.get('document_id'),
                'filename': r.payload.get('filename'),
                'source': r.payload.get('source'),
                'chunk_index': r.payload.get('chunk_index'),
                'total_chunks': r.payload.get('total_chunks'),
                'text_preview': r.payload.get('text_preview', ''),
            }
            for r in results
        ]

    def find_similar(self, point_id: int, limit: int = 20) -> List[Dict]:
        """Find points similar to a given point ID."""
        try:
            results = self.client.recommend(
                collection_name=self.collection,
                positive=[point_id],
                limit=limit,
                with_payload=True
            )
            return [
                {
                    'id': str(r.id),
                    'score': r.score,
                    'document_id': r.payload.get('document_id'),
                    'filename': r.payload.get('filename'),
                    'text_preview': r.payload.get('text_preview', ''),
                }
                for r in results
            ]
        except Exception as e:
            logger.warning(f"Similarity search failed: {e}")
            return []

    def get_collection_info(self) -> Dict:
        """Get collection statistics."""
        info = self.client.get_collection(self.collection)
        return {
            'points_count': info.points_count,
            'indexed_vectors_count': info.indexed_vectors_count,
            'segments_count': info.segments_count,
        }

    def close(self):
        self.client.close()
