#!/usr/bin/env python3
"""
VLM Analysis Semantic Search

Search across VLM-extracted content using semantic similarity.
Supports filtering by document type, source, embedding type, and more.
"""

import os
import sys
import json
import argparse
from typing import List, Dict, Optional
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load environment
load_dotenv('/opt/app/.env')

# Configuration
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
OPENAI_API_URL = 'https://api.openai.com/v1/embeddings'
OPENAI_MODEL = 'text-embedding-3-small'

QDRANT_HOST = os.getenv('QDRANT_HOST', '127.0.0.1')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', 6333))
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY', '')
QDRANT_COLLECTION = 'vlm_analysis'


def generate_query_embedding(query: str) -> Optional[List[float]]:
    """Generate embedding for a search query."""
    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }

    payload = {
        'model': OPENAI_MODEL,
        'input': query
    }

    try:
        response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            result = response.json()
            return result['data'][0]['embedding']
        else:
            print(f"Error generating embedding: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"Error: {e}")
        return None


def search_qdrant(
    query_vector: List[float],
    limit: int = 10,
    embedding_type: Optional[str] = None,
    source: Optional[str] = None,
    document_type: Optional[str] = None,
    min_people: Optional[int] = None,
    score_threshold: float = 0.5
) -> List[Dict]:
    """Search Qdrant for similar vectors."""

    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    # Build filter
    must_conditions = []

    if embedding_type:
        must_conditions.append({
            'key': 'embedding_type',
            'match': {'value': embedding_type}
        })

    if source:
        must_conditions.append({
            'key': 'source',
            'match': {'value': source}
        })

    if document_type:
        must_conditions.append({
            'key': 'document_type',
            'match': {'value': document_type}
        })

    if min_people is not None:
        must_conditions.append({
            'key': 'people_count',
            'range': {'gte': min_people}
        })

    payload = {
        'vector': query_vector,
        'limit': limit,
        'with_payload': True,
        'score_threshold': score_threshold
    }

    if must_conditions:
        payload['filter'] = {'must': must_conditions}

    url = f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/search'

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code == 200:
            result = response.json()
            return result.get('result', [])
        else:
            print(f"Search error: {response.status_code} - {response.text}")
            return []

    except Exception as e:
        print(f"Error: {e}")
        return []


def search_by_document_id(doc_id: str) -> List[Dict]:
    """Get all vectors for a specific document."""
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    payload = {
        'filter': {
            'must': [{
                'key': 'document_id',
                'match': {'value': doc_id}
            }]
        },
        'limit': 10,
        'with_payload': True,
        'with_vector': False
    }

    url = f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/scroll'

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code == 200:
            result = response.json()
            return result.get('result', {}).get('points', [])
        else:
            print(f"Search error: {response.status_code}")
            return []

    except Exception as e:
        print(f"Error: {e}")
        return []


def find_similar_documents(doc_id: str, embedding_type: str = 'full_text', limit: int = 10) -> List[Dict]:
    """Find documents similar to a given document."""
    # First get the document's vector
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    # Get the document's vectors
    vectors = search_by_document_id(doc_id)

    if not vectors:
        print(f"No vectors found for document {doc_id}")
        return []

    # Find the vector with matching embedding type
    target_vector = None
    for v in vectors:
        if v.get('payload', {}).get('embedding_type') == embedding_type:
            target_vector = v
            break

    if not target_vector:
        print(f"No {embedding_type} vector found for document")
        return []

    # Search using this vector (need to get the actual vector)
    point_id = target_vector['id']

    # Get the vector
    url = f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/{point_id}'
    response = requests.get(url, headers=headers, timeout=30)

    if response.status_code != 200:
        print(f"Could not retrieve vector: {response.status_code}")
        return []

    vector_data = response.json().get('result', {}).get('vector', [])

    if not vector_data:
        print("Vector data not found")
        return []

    # Search for similar documents (excluding self)
    payload = {
        'vector': vector_data,
        'limit': limit + 1,  # +1 to account for self
        'with_payload': True,
        'filter': {
            'must': [
                {'key': 'embedding_type', 'match': {'value': embedding_type}}
            ],
            'must_not': [
                {'key': 'document_id', 'match': {'value': doc_id}}
            ]
        }
    }

    url = f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/search'
    response = requests.post(url, headers=headers, json=payload, timeout=30)

    if response.status_code == 200:
        return response.json().get('result', [])[:limit]
    else:
        print(f"Search error: {response.status_code}")
        return []


def format_result(result: Dict, verbose: bool = False) -> str:
    """Format a search result for display."""
    payload = result.get('payload', {})
    score = result.get('score', 0)

    output = []
    output.append(f"\n{'='*60}")
    output.append(f"Score: {score:.4f}")
    output.append(f"Document: {payload.get('filename', 'Unknown')}")
    output.append(f"Source: {payload.get('source', 'Unknown')}")
    output.append(f"Type: {payload.get('document_type', 'Unknown')}")
    output.append(f"Embedding: {payload.get('embedding_type', 'Unknown')}")

    if payload.get('people_count'):
        output.append(f"People count: {payload.get('people_count')}")

    if verbose:
        if payload.get('text_preview'):
            output.append(f"\nText preview: {payload.get('text_preview')[:300]}...")
        if payload.get('people'):
            output.append(f"\nPeople: {payload.get('people')}")
        if payload.get('locations'):
            output.append(f"Locations: {payload.get('locations')}")
        if payload.get('objects'):
            output.append(f"Objects: {payload.get('objects')}")

    return '\n'.join(output)


def get_collection_stats() -> Dict:
    """Get statistics about the VLM analysis collection."""
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    url = f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}'

    try:
        response = requests.get(url, headers=headers, timeout=30)

        if response.status_code == 200:
            result = response.json().get('result', {})
            return {
                'status': result.get('status'),
                'vectors_count': result.get('indexed_vectors_count', 0),
                'points_count': result.get('points_count', 0),
                'segments': result.get('segments_count', 0)
            }
        else:
            return {'error': response.status_code}

    except Exception as e:
        return {'error': str(e)}


def main():
    """Main search function."""
    parser = argparse.ArgumentParser(description='Search VLM analysis embeddings')

    subparsers = parser.add_subparsers(dest='command', help='Command')

    # Text search
    search_parser = subparsers.add_parser('search', help='Semantic text search')
    search_parser.add_argument('query', type=str, help='Search query text')
    search_parser.add_argument('--limit', type=int, default=10, help='Number of results')
    search_parser.add_argument('--type', choices=['full_text', 'people', 'context'],
                               help='Filter by embedding type')
    search_parser.add_argument('--source', type=str, help='Filter by source dataset')
    search_parser.add_argument('--doc-type', type=str, help='Filter by document type')
    search_parser.add_argument('--min-people', type=int, help='Minimum people count')
    search_parser.add_argument('--threshold', type=float, default=0.5, help='Minimum score')
    search_parser.add_argument('--verbose', '-v', action='store_true', help='Show full details')

    # Similar documents
    similar_parser = subparsers.add_parser('similar', help='Find similar documents')
    similar_parser.add_argument('doc_id', type=str, help='Document ID to find similar docs for')
    similar_parser.add_argument('--type', choices=['full_text', 'people', 'context'],
                                default='full_text', help='Embedding type to use')
    similar_parser.add_argument('--limit', type=int, default=10, help='Number of results')
    similar_parser.add_argument('--verbose', '-v', action='store_true', help='Show full details')

    # Document lookup
    doc_parser = subparsers.add_parser('document', help='Get vectors for a document')
    doc_parser.add_argument('doc_id', type=str, help='Document ID to lookup')

    # Stats
    stats_parser = subparsers.add_parser('stats', help='Get collection statistics')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command == 'stats':
        stats = get_collection_stats()
        print(json.dumps(stats, indent=2))
        return

    if args.command == 'document':
        results = search_by_document_id(args.doc_id)
        for r in results:
            print(format_result(r, verbose=True))
        return

    if args.command == 'similar':
        results = find_similar_documents(args.doc_id, args.type, args.limit)
        print(f"\nDocuments similar to {args.doc_id} (by {args.type}):")
        for r in results:
            print(format_result(r, args.verbose))
        return

    if args.command == 'search':
        # Generate query embedding
        print(f"Searching for: {args.query}")
        query_vector = generate_query_embedding(args.query)

        if not query_vector:
            print("Failed to generate query embedding")
            return

        # Search
        results = search_qdrant(
            query_vector,
            limit=args.limit,
            embedding_type=args.type,
            source=args.source,
            document_type=args.doc_type,
            min_people=args.min_people,
            score_threshold=args.threshold
        )

        print(f"\nFound {len(results)} results:")
        for r in results:
            print(format_result(r, args.verbose))


if __name__ == '__main__':
    main()
