#!/usr/bin/env python3
"""
Embedding Generator - Generates embeddings via Cloudflare Workers AI REST API.

Calls the BGE-base-en-v1.5 model directly via Cloudflare API.
Stores vectors in Qdrant with document metadata.

Rate limited to respect Workers AI limits (600 requests/min for embeddings).
"""

import os
import sys
import time
import json
import logging
import uuid
from typing import Optional, List, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance

# Configuration
PG_HOST = os.environ.get('PG_HOST', 'postgres')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

QDRANT_HOST = os.environ.get('QDRANT_HOST', 'qdrant')
QDRANT_PORT = int(os.environ.get('QDRANT_PORT', 6333))
QDRANT_API_KEY = os.environ.get('QDRANT_API_KEY', '')
QDRANT_COLLECTION = os.environ.get('QDRANT_COLLECTION', 'document_embeddings')

# Cloudflare Worker API for embeddings (uses internal AI binding)
WORKER_URL = os.environ.get('WORKER_URL', 'https://epstein-api.carl-f-frank.workers.dev')
API_SECRET_KEY = os.environ.get('API_SECRET_KEY', '')

BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 10))
EMBEDDING_BATCH_SIZE = int(os.environ.get('EMBEDDING_BATCH_SIZE', 20))  # Texts per embedding request
REQUESTS_PER_MINUTE = int(os.environ.get('REQUESTS_PER_MINUTE', 300))
WORKER_ID = os.environ.get('WORKER_ID', '1')

# BGE-base-en-v1.5 produces 768-dimensional vectors
EMBEDDING_DIMENSION = 768

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format=f'[Embed-Worker-{WORKER_ID}] %(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


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
        host=PG_HOST,
        port=PG_PORT,
        database=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD
    )


def get_qdrant_client():
    """Create a Qdrant client."""
    return QdrantClient(
        host=QDRANT_HOST,
        port=QDRANT_PORT,
        api_key=QDRANT_API_KEY if QDRANT_API_KEY else None,
        https=False  # Use HTTP for internal Docker network
    )


def ensure_collection(qdrant_client: QdrantClient):
    """Ensure the Qdrant collection exists with correct config."""
    collections = qdrant_client.get_collections().collections
    collection_names = [c.name for c in collections]

    if QDRANT_COLLECTION not in collection_names:
        logger.info(f"Creating collection {QDRANT_COLLECTION}")
        qdrant_client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(
                size=EMBEDDING_DIMENSION,
                distance=Distance.COSINE
            )
        )
    else:
        logger.info(f"Collection {QDRANT_COLLECTION} exists")


def generate_embedding(text: str, rate_limiter: RateLimiter) -> Tuple[Optional[List[float]], Optional[str]]:
    """
    Generate embedding via Cloudflare Worker's /ai/embedding endpoint.
    The Worker uses its internal AI binding which has proper authentication.
    Returns (embedding_vector, error_message).
    """
    rate_limiter.wait()

    url = f"{WORKER_URL}/ai/embedding"

    headers = {
        'X-API-Key': API_SECRET_KEY,
        'Content-Type': 'application/json'
    }

    # Truncate text to fit model context (BGE has ~512 token limit)
    # Worker also truncates to 8000 chars, but we limit to 2000 for safety
    truncated_text = text[:2000] if len(text) > 2000 else text

    payload = {
        'text': truncated_text
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code == 429:
            # Rate limited - wait and signal retry
            logger.warning("Rate limited, waiting 60s...")
            time.sleep(60)
            return None, "rate_limited"

        if response.status_code == 401:
            return None, "Unauthorized - check API_SECRET_KEY"

        if response.status_code != 200:
            return None, f"API error {response.status_code}: {response.text}"

        result = response.json()

        # Extract embedding from Worker response format
        embedding = result.get('embedding')
        if not embedding:
            return None, f"No embedding in response: {result}"

        if len(embedding) != EMBEDDING_DIMENSION:
            return None, f"Wrong embedding dimension: {len(embedding)}"

        return embedding, None

    except requests.exceptions.Timeout:
        return None, "timeout"
    except Exception as e:
        return None, str(e)


def generate_embeddings_batch(texts: List[str], rate_limiter: RateLimiter) -> Tuple[Optional[List[List[float]]], Optional[str]]:
    """
    Generate embeddings for multiple texts in a single request.
    Uses the Worker's /ai/embeddings-batch endpoint for efficiency.
    Returns (list_of_embeddings, error_message).
    """
    rate_limiter.wait()

    url = f"{WORKER_URL}/ai/embeddings-batch"

    headers = {
        'X-API-Key': API_SECRET_KEY,
        'Content-Type': 'application/json'
    }

    # Truncate each text
    truncated_texts = [t[:2000] if len(t) > 2000 else t for t in texts]

    payload = {
        'texts': truncated_texts
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=60)

        if response.status_code == 429:
            logger.warning("Rate limited, waiting 60s...")
            time.sleep(60)
            return None, "rate_limited"

        if response.status_code == 401:
            return None, "Unauthorized - check API_SECRET_KEY"

        if response.status_code != 200:
            return None, f"API error {response.status_code}: {response.text}"

        result = response.json()

        embeddings = result.get('embeddings')
        if not embeddings:
            return None, f"No embeddings in response: {result}"

        # Verify dimensions
        for i, emb in enumerate(embeddings):
            if len(emb) != EMBEDDING_DIMENSION:
                return None, f"Wrong embedding dimension at index {i}: {len(emb)}"

        return embeddings, None

    except requests.exceptions.Timeout:
        return None, "timeout"
    except Exception as e:
        return None, str(e)


def claim_documents(conn, limit: int) -> list:
    """
    Claim documents for embedding generation using FOR UPDATE SKIP LOCKED.
    Returns list of document records.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Find documents that:
        # - Have extracted text in metadata
        # - Don't have embedding yet (embedding_status != 'completed')
        # - Not marked with embedding error
        cur.execute("""
            WITH claimed AS (
                SELECT id, filename, source, metadata
                FROM documents
                WHERE metadata->>'text' IS NOT NULL
                  AND LENGTH(metadata->>'text') > 100
                  AND (embedding_status IS NULL OR embedding_status = 'pending')
                  AND (metadata IS NULL OR metadata->>'embedding_error' IS NULL)
                ORDER BY created_at ASC
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents d
            SET metadata = COALESCE(d.metadata, '{}'::jsonb) ||
                           jsonb_build_object('embedding_started', NOW()::text, 'embed_worker_id', %s),
                embedding_status = 'processing'
            FROM claimed c
            WHERE d.id = c.id
            RETURNING d.id, d.filename, d.source, d.metadata
        """, (limit, WORKER_ID))

        conn.commit()
        return cur.fetchall()


def update_document_embedding_status(conn, doc_id: str, status: str, qdrant_point_id: Optional[str] = None):
    """Update document embedding status after processing."""
    with conn.cursor() as cur:
        metadata_update = {
            'embedding_completed': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'embed_worker_id': WORKER_ID
        }
        if qdrant_point_id:
            metadata_update['qdrant_point_id'] = qdrant_point_id

        cur.execute("""
            UPDATE documents
            SET embedding_status = %s,
                metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                processed_at = NOW()
            WHERE id = %s
        """, (status, json.dumps(metadata_update), doc_id))

        conn.commit()


def mark_document_embedding_error(conn, doc_id: str, error: str):
    """Mark document with embedding error."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET embedding_status = 'error',
                metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('embedding_error', %s, 'embed_worker_id', %s),
                processed_at = NOW()
            WHERE id = %s
        """, (error, WORKER_ID, doc_id))
        conn.commit()


def store_embedding(qdrant_client: QdrantClient, doc_id: str, embedding: List[float],
                    filename: str, source: str) -> str:
    """
    Store embedding in Qdrant.
    Returns the point ID.
    """
    # Use doc_id as point ID (convert UUID to int-compatible form)
    point_id = str(uuid.UUID(doc_id).int % (10**18))

    point = PointStruct(
        id=int(point_id),
        vector=embedding,
        payload={
            'document_id': doc_id,
            'filename': filename,
            'source': source,
            'indexed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ')
        }
    )

    qdrant_client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=[point]
    )

    return point_id


def process_batch(conn, qdrant_client: QdrantClient, rate_limiter: RateLimiter) -> int:
    """
    Process a batch of documents for embedding generation.
    Returns number of documents processed.
    """
    documents = claim_documents(conn, BATCH_SIZE)

    if not documents:
        return 0

    logger.info(f"Processing batch of {len(documents)} documents for embeddings")

    processed = 0
    for doc in documents:
        doc_id = str(doc['id'])
        filename = doc['filename']
        source = doc['source']
        metadata = doc['metadata'] or {}

        # Get text from metadata
        text = metadata.get('text', '')
        if not text or len(text) < 100:
            logger.warning(f"Insufficient text for {filename}")
            mark_document_embedding_error(conn, doc_id, "insufficient_text")
            continue

        # Generate embedding
        embedding, error = generate_embedding(text, rate_limiter)

        if error == "rate_limited":
            # Don't count as processed, will retry
            logger.warning(f"Rate limited on {filename}, will retry")
            continue

        if error:
            logger.error(f"Embedding error for {filename}: {error}")
            mark_document_embedding_error(conn, doc_id, error)
            processed += 1
            continue

        # Store in Qdrant
        try:
            point_id = store_embedding(qdrant_client, doc_id, embedding, filename, source)
            update_document_embedding_status(conn, doc_id, 'completed', point_id)
            logger.info(f"Generated embedding for {filename} (point_id: {point_id})")
        except Exception as e:
            logger.error(f"Qdrant error for {filename}: {e}")
            mark_document_embedding_error(conn, doc_id, f"qdrant_error: {str(e)}")

        processed += 1

    return processed


def get_stats(conn) -> dict:
    """Get embedding statistics."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
                COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as has_embedding,
                COUNT(CASE WHEN embedding_status = 'processing' THEN 1 END) as processing,
                COUNT(CASE WHEN embedding_status = 'error' THEN 1 END) as errors
            FROM documents
            WHERE filename LIKE '%%.pdf'
        """)
        return cur.fetchone()


def main():
    """Main processing loop."""
    logger.info(f"Starting Embedding Generator Worker {WORKER_ID}")
    logger.info(f"Worker URL: {WORKER_URL}")
    logger.info(f"Batch size: {BATCH_SIZE}")
    logger.info(f"Rate limit: {REQUESTS_PER_MINUTE} requests/min")

    if not API_SECRET_KEY:
        logger.error("API_SECRET_KEY not configured - required for Worker API authentication")
        sys.exit(1)

    conn = get_db_connection()
    qdrant_client = get_qdrant_client()
    rate_limiter = RateLimiter(REQUESTS_PER_MINUTE)

    # Ensure collection exists
    ensure_collection(qdrant_client)

    # Print initial stats
    stats = get_stats(conn)
    logger.info(f"Initial stats: {stats}")

    total_processed = 0
    consecutive_empty = 0

    while True:
        try:
            processed = process_batch(conn, qdrant_client, rate_limiter)
            total_processed += processed

            if processed == 0:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    logger.info(f"No documents to embed. Total processed: {total_processed}. Waiting 30s...")
                    time.sleep(30)
                else:
                    time.sleep(5)
            else:
                consecutive_empty = 0
                logger.info(f"Batch complete. Total processed: {total_processed}")

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


if __name__ == '__main__':
    main()
