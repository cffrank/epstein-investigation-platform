#!/usr/bin/env python3
"""
VLM Results Embedding Generator

Generates embeddings for VLM-extracted content and uploads to Qdrant.
Uses OpenAI text-embedding-3-small model (1536 dimensions).

Embedding Strategy:
1. Full text embedding - Complete OCR'd text for document-level search
2. People descriptions embedding - Combined people descriptions for finding similar scenes
3. Context embedding - Locations + objects + document type for contextual similarity

Each document gets 1-3 vectors depending on content availability.
"""

import os
import sys
import json
import time
import uuid
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from tqdm import tqdm

# Add parent directory for config
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB,
    POSTGRES_USER, POSTGRES_PASSWORD, LOGS_DIR
)

# Load environment
from dotenv import load_dotenv
load_dotenv('/opt/app/.env')

# Configuration
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
OPENAI_API_URL = 'https://api.openai.com/v1/embeddings'
OPENAI_MODEL = 'text-embedding-3-small'
EMBEDDING_DIMENSION = 1536

QDRANT_HOST = os.getenv('QDRANT_HOST', '127.0.0.1')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', 6333))
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY', '')
QDRANT_COLLECTION = 'vlm_analysis'

# Rate limiting - OpenAI allows 500 RPM on tier 1
REQUESTS_PER_MINUTE = 400
BATCH_SIZE = 50  # Documents per batch

# Text limits
MAX_TEXT_LENGTH = 8000  # Characters for embedding
MIN_TEXT_LENGTH = 20  # Minimum chars to generate embedding

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOGS_DIR / 'embed_vlm.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class EmbeddingRequest:
    """Represents a single embedding request."""
    point_id: str
    document_id: str
    filename: str
    source: str
    text: str
    embedding_type: str  # 'full_text', 'people', 'context'
    metadata: dict


class RateLimiter:
    """Simple rate limiter to respect API limits."""

    def __init__(self, requests_per_minute: int):
        self.interval = 60.0 / requests_per_minute
        self.last_request = 0

    def wait(self):
        """Wait if necessary to respect rate limit."""
        now = time.time()
        elapsed = now - self.last_request
        if elapsed < self.interval:
            time.sleep(self.interval - elapsed)
        self.last_request = time.time()


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )


def get_documents_with_vlm_results(limit: int = None) -> List[Dict]:
    """Get documents that have VLM results but no embeddings yet."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                SELECT id, filename, source, metadata
                FROM documents
                WHERE metadata->>'vlm_status' = 'complete'
                  AND (metadata->>'vlm_embedded' IS NULL
                       OR metadata->>'vlm_embedded' = 'false')
                ORDER BY processed_at DESC NULLS LAST
            """
            if limit:
                query += f" LIMIT {limit}"
            cur.execute(query)
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def update_embedding_status(doc_ids: List[str], status: str, vector_count: int = 0):
    """Update embedding status for documents."""
    if not doc_ids:
        return

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            update = {
                'vlm_embedded': status == 'complete',
                'vlm_embedded_at': datetime.utcnow().isoformat(),
                'vlm_vector_count': vector_count
            }
            cur.execute("""
                UPDATE documents
                SET metadata = metadata || %s::jsonb
                WHERE id = ANY(%s::uuid[])
            """, (json.dumps(update), doc_ids))
            conn.commit()
    finally:
        conn.close()


def prepare_embedding_requests(doc: Dict) -> List[EmbeddingRequest]:
    """Prepare embedding requests for a document."""
    requests_list = []
    doc_id = str(doc['id'])
    filename = doc['filename']
    source = doc.get('source', 'unknown')
    metadata = doc.get('metadata', {})
    vlm_results = metadata.get('vlm_results', {})

    # Common metadata for all vectors
    base_metadata = {
        'document_id': doc_id,
        'filename': filename,
        'source': source,
        'document_type': vlm_results.get('document_type', 'unknown'),
        'vlm_confidence': vlm_results.get('confidence', 0),
        'processed_at': datetime.utcnow().isoformat()
    }

    # 1. Full text embedding
    text = vlm_results.get('text', '')
    if text and len(text.strip()) >= MIN_TEXT_LENGTH:
        text_preview = text[:500] if len(text) > 500 else text
        requests_list.append(EmbeddingRequest(
            point_id=f"{doc_id}_text",
            document_id=doc_id,
            filename=filename,
            source=source,
            text=text[:MAX_TEXT_LENGTH],
            embedding_type='full_text',
            metadata={
                **base_metadata,
                'embedding_type': 'full_text',
                'text_length': len(text),
                'text_preview': text_preview,
                'people_count': len(vlm_results.get('people', [])),
                'locations': vlm_results.get('locations', []),
                'objects': vlm_results.get('objects', [])
            }
        ))

    # 2. People descriptions embedding
    people = vlm_results.get('people', [])
    if people:
        # Combine all people descriptions
        people_text = " | ".join([
            p if isinstance(p, str) else p.get('description', str(p))
            for p in people
        ])
        if len(people_text.strip()) >= MIN_TEXT_LENGTH:
            requests_list.append(EmbeddingRequest(
                point_id=f"{doc_id}_people",
                document_id=doc_id,
                filename=filename,
                source=source,
                text=people_text[:MAX_TEXT_LENGTH],
                embedding_type='people',
                metadata={
                    **base_metadata,
                    'embedding_type': 'people',
                    'people': people,
                    'people_count': len(people)
                }
            ))

    # 3. Context embedding (locations + objects + type)
    locations = vlm_results.get('locations', [])
    objects = vlm_results.get('objects', [])
    doc_type = vlm_results.get('document_type', '')

    context_parts = []
    if doc_type:
        context_parts.append(f"Document type: {doc_type}")
    if locations:
        loc_text = ", ".join(locations) if isinstance(locations, list) else str(locations)
        context_parts.append(f"Locations: {loc_text}")
    if objects:
        obj_text = ", ".join(objects) if isinstance(objects, list) else str(objects)
        context_parts.append(f"Objects: {obj_text}")

    context_text = ". ".join(context_parts)
    if len(context_text.strip()) >= MIN_TEXT_LENGTH:
        requests_list.append(EmbeddingRequest(
            point_id=f"{doc_id}_context",
            document_id=doc_id,
            filename=filename,
            source=source,
            text=context_text[:MAX_TEXT_LENGTH],
            embedding_type='context',
            metadata={
                **base_metadata,
                'embedding_type': 'context',
                'locations': locations,
                'objects': objects
            }
        ))

    return requests_list


def generate_embedding(text: str, rate_limiter: RateLimiter) -> Tuple[Optional[List[float]], Optional[str]]:
    """Generate embedding via OpenAI API."""
    rate_limiter.wait()

    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }

    payload = {
        'model': OPENAI_MODEL,
        'input': text
    }

    try:
        response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=30)

        if response.status_code == 200:
            result = response.json()
            embedding = result['data'][0]['embedding']
            return embedding, None
        elif response.status_code == 429:
            # Rate limited - wait and retry
            retry_after = int(response.headers.get('Retry-After', 60))
            logger.warning(f"Rate limited, waiting {retry_after}s")
            time.sleep(retry_after)
            return generate_embedding(text, rate_limiter)
        else:
            return None, f"API error: {response.status_code} - {response.text[:200]}"

    except requests.exceptions.Timeout:
        return None, "Request timeout"
    except requests.exceptions.RequestException as e:
        return None, f"Request failed: {str(e)}"


def generate_embeddings_batch(texts: List[str], rate_limiter: RateLimiter) -> Tuple[List[List[float]], List[str]]:
    """Generate embeddings for multiple texts in a single API call."""
    rate_limiter.wait()

    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }

    payload = {
        'model': OPENAI_MODEL,
        'input': texts
    }

    try:
        response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=60)

        if response.status_code == 200:
            result = response.json()
            embeddings = [item['embedding'] for item in sorted(result['data'], key=lambda x: x['index'])]
            return embeddings, []
        elif response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 60))
            logger.warning(f"Rate limited, waiting {retry_after}s")
            time.sleep(retry_after)
            return generate_embeddings_batch(texts, rate_limiter)
        else:
            return [], [f"API error: {response.status_code}"] * len(texts)

    except Exception as e:
        return [], [str(e)] * len(texts)


def upload_to_qdrant(points: List[Dict]) -> bool:
    """Upload points to Qdrant collection."""
    if not points:
        return True

    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    url = f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points?wait=true'

    payload = {'points': points}

    try:
        response = requests.put(url, headers=headers, json=payload, timeout=120)

        if response.status_code == 200:
            return True
        else:
            logger.error(f"Qdrant upload failed: {response.status_code} - {response.text[:500]}")
            return False

    except Exception as e:
        logger.error(f"Qdrant upload error: {e}")
        return False


def process_batch(docs: List[Dict], rate_limiter: RateLimiter) -> Dict:
    """Process a batch of documents."""
    stats = {
        'documents': len(docs),
        'embeddings_generated': 0,
        'embeddings_uploaded': 0,
        'errors': 0
    }

    # Prepare all embedding requests
    all_requests = []
    for doc in docs:
        try:
            requests_list = prepare_embedding_requests(doc)
            all_requests.extend(requests_list)
        except Exception as e:
            logger.error(f"Error preparing embeddings for {doc.get('filename')}: {e}")
            stats['errors'] += 1

    if not all_requests:
        logger.warning("No embedding requests generated from batch")
        return stats

    # Generate embeddings in batches
    batch_texts = [req.text for req in all_requests]

    # Process in sub-batches of 20 (OpenAI batch limit)
    all_embeddings = []
    for i in range(0, len(batch_texts), 20):
        sub_batch = batch_texts[i:i+20]
        embeddings, errors = generate_embeddings_batch(sub_batch, rate_limiter)

        if embeddings:
            all_embeddings.extend(embeddings)
            stats['embeddings_generated'] += len(embeddings)
        else:
            # Fall back to individual requests
            for text in sub_batch:
                emb, err = generate_embedding(text, rate_limiter)
                if emb:
                    all_embeddings.append(emb)
                    stats['embeddings_generated'] += 1
                else:
                    all_embeddings.append(None)
                    stats['errors'] += 1
                    logger.error(f"Embedding failed: {err}")

    # Create Qdrant points
    points = []
    doc_vector_counts = {}

    for i, (req, embedding) in enumerate(zip(all_requests, all_embeddings)):
        if embedding is None:
            continue

        # Generate deterministic UUID from point_id
        point_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, req.point_id))

        point = {
            'id': point_uuid,
            'vector': embedding,
            'payload': req.metadata
        }
        points.append(point)

        # Track vectors per document
        doc_id = req.document_id
        doc_vector_counts[doc_id] = doc_vector_counts.get(doc_id, 0) + 1

    # Upload to Qdrant
    if points:
        # Upload in chunks of 100
        for i in range(0, len(points), 100):
            chunk = points[i:i+100]
            if upload_to_qdrant(chunk):
                stats['embeddings_uploaded'] += len(chunk)
            else:
                stats['errors'] += len(chunk)

    # Update document status
    doc_ids = [str(doc['id']) for doc in docs]
    total_vectors = sum(doc_vector_counts.values())
    update_embedding_status(doc_ids, 'complete', total_vectors)

    return stats


def main():
    """Main embedding generation function."""
    import argparse
    parser = argparse.ArgumentParser(description='Generate embeddings for VLM results')
    parser.add_argument('--limit', type=int, help='Limit number of documents to process')
    parser.add_argument('--batch-size', type=int, default=BATCH_SIZE, help='Documents per batch')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be processed without running')
    args = parser.parse_args()

    if not OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY not set")
        sys.exit(1)

    if not QDRANT_API_KEY:
        logger.error("QDRANT_API_KEY not set")
        sys.exit(1)

    # Get documents needing embeddings
    logger.info("Fetching documents with VLM results...")
    docs = get_documents_with_vlm_results(limit=args.limit)

    if not docs:
        logger.info("No documents found needing embeddings")
        return

    logger.info(f"Found {len(docs)} documents to process")

    if args.dry_run:
        logger.info("Dry run - would process these documents:")
        for doc in docs[:10]:
            logger.info(f"  - {doc['filename']} ({doc['source']})")
        if len(docs) > 10:
            logger.info(f"  ... and {len(docs) - 10} more")
        return

    # Process in batches
    rate_limiter = RateLimiter(REQUESTS_PER_MINUTE)
    total_stats = {
        'documents': 0,
        'embeddings_generated': 0,
        'embeddings_uploaded': 0,
        'errors': 0
    }

    for i in range(0, len(docs), args.batch_size):
        batch = docs[i:i+args.batch_size]
        batch_num = i // args.batch_size + 1
        total_batches = (len(docs) + args.batch_size - 1) // args.batch_size

        logger.info(f"\nProcessing batch {batch_num}/{total_batches} ({len(batch)} docs)")

        stats = process_batch(batch, rate_limiter)

        for key in total_stats:
            total_stats[key] += stats[key]

        logger.info(f"Batch stats: {json.dumps(stats)}")

    # Summary
    logger.info(f"\n{'='*50}")
    logger.info("EMBEDDING GENERATION COMPLETE")
    logger.info(f"  Documents processed: {total_stats['documents']}")
    logger.info(f"  Embeddings generated: {total_stats['embeddings_generated']}")
    logger.info(f"  Embeddings uploaded: {total_stats['embeddings_uploaded']}")
    logger.info(f"  Errors: {total_stats['errors']}")

    # Estimate cost
    # text-embedding-3-small: $0.02 per 1M tokens
    # Rough estimate: 1 token ~ 4 chars, average text ~2000 chars = 500 tokens
    est_tokens = total_stats['embeddings_generated'] * 500
    est_cost = (est_tokens / 1_000_000) * 0.02
    logger.info(f"\nEstimated embedding cost: ${est_cost:.4f}")


if __name__ == '__main__':
    main()
