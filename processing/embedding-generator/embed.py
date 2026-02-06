#!/usr/bin/env python3
"""
Embedding Generator - Generates embeddings via OpenAI API.

Uses text-embedding-3-small model (1536 dimensions, 8191 token context).
Stores vectors in Qdrant with document metadata.

CHUNKING: Long documents are split into overlapping chunks to capture
full semantic content. Each chunk becomes a separate vector in Qdrant,
linked back to the parent document.
"""

import os
import sys
import time
import json
import logging
import hashlib
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
QDRANT_COLLECTION = os.environ.get('QDRANT_COLLECTION', 'document_embeddings_v2')

# OpenAI API configuration
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_API_URL = 'https://api.openai.com/v1/embeddings'
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'text-embedding-3-small')

BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 10))
REQUESTS_PER_MINUTE = int(os.environ.get('REQUESTS_PER_MINUTE', 500))  # OpenAI allows 500 RPM on tier 1
WORKER_ID = os.environ.get('WORKER_ID', '1')

# Chunking configuration - larger chunks since OpenAI has 8191 token context
CHUNK_SIZE = int(os.environ.get('CHUNK_SIZE', 6000))  # ~1500 tokens worth of chars
CHUNK_OVERLAP = int(os.environ.get('CHUNK_OVERLAP', 500))  # Overlap between chunks
MAX_CHUNKS_PER_DOC = int(os.environ.get('MAX_CHUNKS_PER_DOC', 20))  # Limit chunks for very long docs

# text-embedding-3-small produces 1536-dimensional vectors
EMBEDDING_DIMENSION = 1536

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


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[dict]:
    """
    Split text into overlapping chunks for better semantic coverage.

    Returns list of dicts with:
      - text: the chunk text
      - start_char: starting character position
      - end_char: ending character position
      - chunk_index: 0-based index
    """
    if not text or len(text) <= chunk_size:
        return [{
            'text': text,
            'start_char': 0,
            'end_char': len(text) if text else 0,
            'chunk_index': 0
        }]

    chunks = []
    start = 0
    chunk_index = 0

    while start < len(text) and chunk_index < MAX_CHUNKS_PER_DOC:
        end = start + chunk_size

        # Try to break at sentence or word boundary
        if end < len(text):
            # Look for sentence boundary (. ! ?) in last 500 chars of chunk
            search_start = max(start + chunk_size - 500, start)
            best_break = -1

            for i in range(end, search_start, -1):
                if text[i-1] in '.!?\n' and (i >= len(text) or text[i] in ' \n\t'):
                    best_break = i
                    break

            # Fall back to word boundary
            if best_break == -1:
                for i in range(end, search_start, -1):
                    if text[i-1] in ' \n\t':
                        best_break = i
                        break

            if best_break > start:
                end = best_break

        chunk_text_str = text[start:end].strip()

        if chunk_text_str:  # Only add non-empty chunks
            chunks.append({
                'text': chunk_text_str,
                'start_char': start,
                'end_char': end,
                'chunk_index': chunk_index
            })
            chunk_index += 1

        # Move start position, accounting for overlap
        start = end - overlap
        if chunks and start <= chunks[-1]['start_char']:
            start = end  # Prevent infinite loop

    return chunks


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
        logger.info(f"Creating collection {QDRANT_COLLECTION} with {EMBEDDING_DIMENSION} dimensions")
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
    Generate embedding via OpenAI API.
    Returns (embedding_vector, error_message).
    """
    rate_limiter.wait()

    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }

    # OpenAI text-embedding-3-small has 8191 token limit (~32k chars)
    # But we chunk to ~6000 chars to be safe
    truncated_text = text[:8000] if len(text) > 8000 else text

    payload = {
        'model': OPENAI_MODEL,
        'input': truncated_text
    }

    try:
        response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=30)

        if response.status_code == 429:
            # Rate limited - wait and signal retry
            retry_after = int(response.headers.get('Retry-After', 60))
            logger.warning(f"Rate limited, waiting {retry_after}s...")
            time.sleep(retry_after)
            return None, "rate_limited"

        if response.status_code == 401:
            return None, "Unauthorized - check OPENAI_API_KEY"

        if response.status_code != 200:
            return None, f"API error {response.status_code}: {response.text}"

        result = response.json()

        # Extract embedding from OpenAI response format
        embedding = result.get('data', [{}])[0].get('embedding')
        if not embedding:
            return None, f"No embedding in response: {result}"

        if len(embedding) != EMBEDDING_DIMENSION:
            return None, f"Wrong embedding dimension: {len(embedding)}, expected {EMBEDDING_DIMENSION}"

        return embedding, None

    except requests.exceptions.Timeout:
        return None, "timeout"
    except Exception as e:
        return None, str(e)


def generate_embeddings_batch(texts: List[str], rate_limiter: RateLimiter) -> Tuple[Optional[List[List[float]]], Optional[str]]:
    """
    Generate embeddings for multiple texts in a single request.
    OpenAI supports batch embedding which is more efficient.
    Returns (list_of_embeddings, error_message).
    """
    rate_limiter.wait()

    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }

    # Truncate each text
    truncated_texts = [t[:8000] if len(t) > 8000 else t for t in texts]

    payload = {
        'model': OPENAI_MODEL,
        'input': truncated_texts
    }

    try:
        response = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=60)

        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 60))
            logger.warning(f"Rate limited, waiting {retry_after}s...")
            time.sleep(retry_after)
            return None, "rate_limited"

        if response.status_code == 401:
            return None, "Unauthorized - check OPENAI_API_KEY"

        if response.status_code != 200:
            return None, f"API error {response.status_code}: {response.text}"

        result = response.json()

        # Extract embeddings from OpenAI response format
        data = result.get('data', [])
        if not data:
            return None, f"No data in response: {result}"

        # Sort by index to ensure correct order
        data.sort(key=lambda x: x.get('index', 0))
        embeddings = [item.get('embedding') for item in data]

        # Verify dimensions
        for i, emb in enumerate(embeddings):
            if not emb or len(emb) != EMBEDDING_DIMENSION:
                return None, f"Wrong embedding dimension at index {i}: {len(emb) if emb else 'None'}"

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
        # - Don't have v2 embedding yet
        # - Not marked with embedding error
        cur.execute("""
            WITH claimed AS (
                SELECT id, filename, source, metadata
                FROM documents
                WHERE metadata->>'text' IS NOT NULL
                  AND LENGTH(metadata->>'text') > 100
                  AND metadata->>'embedding_v2' IS NULL
                  AND metadata->>'embedding_v2_error' IS NULL
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents d
            SET metadata = COALESCE(d.metadata, '{}'::jsonb) ||
                           jsonb_build_object('embedding_v2_started', NOW()::text, 'embed_worker_id', %s)
            FROM claimed c
            WHERE d.id = c.id
            RETURNING d.id, d.filename, d.source, d.metadata
        """, (limit, WORKER_ID))

        conn.commit()
        return cur.fetchall()


def update_document_embedding_status(conn, doc_id: str, chunk_count: int = 1,
                                      qdrant_point_ids: Optional[List[str]] = None,
                                      commit: bool = True):
    """Update document embedding status after processing."""
    with conn.cursor() as cur:
        metadata_update = {
            'embedding_v2': 'completed',
            'embedding_v2_completed': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'embed_worker_id': WORKER_ID,
            'chunk_count_v2': chunk_count,
            'embedding_model': OPENAI_MODEL
        }
        if qdrant_point_ids:
            metadata_update['qdrant_point_ids_v2'] = qdrant_point_ids

        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
            WHERE id = %s
        """, (json.dumps(metadata_update), doc_id))

        if commit:
            conn.commit()


def mark_document_embedding_error(conn, doc_id: str, error: str, commit: bool = True):
    """Mark document with embedding error."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('embedding_v2_error', %s, 'embed_worker_id', %s)
            WHERE id = %s
        """, (error, WORKER_ID, doc_id))
        if commit:
            conn.commit()


def generate_chunk_point_id(doc_id: str, chunk_index: int) -> int:
    """Generate a unique point ID for a document chunk."""
    # Create a deterministic ID from doc_id and chunk_index
    combined = f"{doc_id}_v2_{chunk_index}"
    hash_int = int(hashlib.md5(combined.encode()).hexdigest()[:16], 16)
    return hash_int % (10**18)


def create_point(doc_id: str, chunk: dict, embedding: List[float],
                 filename: str, source: str, total_chunks: int) -> Tuple[PointStruct, str]:
    """
    Create a Qdrant point for a chunk (without storing it).
    Returns (point, point_id).
    """
    point_id = generate_chunk_point_id(doc_id, chunk['chunk_index'])

    # Create text preview (first 200 chars of chunk)
    text_preview = chunk['text'][:200] + '...' if len(chunk['text']) > 200 else chunk['text']

    point = PointStruct(
        id=point_id,
        vector=embedding,
        payload={
            'document_id': doc_id,
            'filename': filename,
            'source': source,
            'chunk_index': chunk['chunk_index'],
            'total_chunks': total_chunks,
            'start_char': chunk['start_char'],
            'end_char': chunk['end_char'],
            'text_preview': text_preview,
            'embedding_model': OPENAI_MODEL,
            'indexed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ')
        }
    )

    return point, str(point_id)


def store_points_batch(qdrant_client: QdrantClient, points: List[PointStruct]):
    """Store multiple points in Qdrant in a single batch upsert."""
    if points:
        qdrant_client.upsert(
            collection_name=QDRANT_COLLECTION,
            points=points,
            wait=False  # Async write for speed
        )


def process_batch(conn, qdrant_client: QdrantClient, rate_limiter: RateLimiter) -> Tuple[int, int]:
    """
    Process a batch of documents for embedding generation.
    Collects ALL chunks from ALL docs, embeds in batches, stores in ONE Qdrant call.
    Returns (documents_processed, chunks_embedded).
    """
    documents = claim_documents(conn, BATCH_SIZE)

    if not documents:
        return 0, 0

    logger.info(f"Processing batch of {len(documents)} documents for embeddings")

    # Collect all chunks from all documents
    all_chunks_info = []  # List of (doc_id, filename, source, chunk, total_chunks)
    doc_results = {}  # doc_id -> {'point_ids': [], 'errors': 0, 'total_chunks': 0}

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
            doc_results[doc_id] = {'point_ids': [], 'errors': 0, 'total_chunks': 0, 'done': True}
            continue

        # Chunk the document
        chunks = chunk_text(text)
        total_chunks = len(chunks)

        doc_results[doc_id] = {'point_ids': [], 'errors': 0, 'total_chunks': total_chunks, 'done': False, 'filename': filename}

        for chunk in chunks:
            all_chunks_info.append((doc_id, filename, source, chunk, total_chunks))

    if not all_chunks_info:
        return len(documents), 0

    logger.info(f"Embedding {len(all_chunks_info)} chunks from {len([d for d in doc_results.values() if not d.get('done')])} documents")

    # Embed all chunks in batches of 20 (OpenAI batch limit)
    all_points = []
    for batch_start in range(0, len(all_chunks_info), 20):
        batch_info = all_chunks_info[batch_start:batch_start + 20]
        batch_texts = [info[3]['text'] for info in batch_info]

        embeddings, error = generate_embeddings_batch(batch_texts, rate_limiter)

        if error == "rate_limited":
            logger.warning(f"Rate limited, retrying batch...")
            time.sleep(1)
            embeddings, error = generate_embeddings_batch(batch_texts, rate_limiter)

        if error:
            logger.error(f"Embedding error: {error}")
            for info in batch_info:
                doc_results[info[0]]['errors'] += 1
            continue

        # Create points
        for (doc_id, filename, source, chunk, total_chunks), embedding in zip(batch_info, embeddings):
            try:
                point, point_id = create_point(doc_id, chunk, embedding, filename, source, total_chunks)
                all_points.append(point)
                doc_results[doc_id]['point_ids'].append(point_id)
            except Exception as e:
                logger.error(f"Point creation error: {e}")
                doc_results[doc_id]['errors'] += 1

    # Single batch upsert to Qdrant
    if all_points:
        try:
            logger.info(f"Upserting {len(all_points)} points to Qdrant...")
            store_points_batch(qdrant_client, all_points)
            logger.info(f"Qdrant upsert complete")
        except Exception as e:
            logger.error(f"Qdrant batch error: {e}")
            # Mark all as failed
            for doc_id in doc_results:
                if doc_results[doc_id]['point_ids']:
                    doc_results[doc_id]['errors'] += len(doc_results[doc_id]['point_ids'])
                    doc_results[doc_id]['point_ids'] = []

    # Update document statuses (batch all updates, commit once)
    total_chunks_embedded = 0
    for doc_id, result in doc_results.items():
        if result.get('done'):
            continue

        if result['point_ids']:
            update_document_embedding_status(conn, doc_id,
                                            chunk_count=len(result['point_ids']),
                                            qdrant_point_ids=result['point_ids'],
                                            commit=False)  # Don't commit individually
            total_chunks_embedded += len(result['point_ids'])
            if result['errors'] > 0:
                logger.warning(f"Completed {result.get('filename', doc_id)} with {len(result['point_ids'])}/{result['total_chunks']} chunks")
        else:
            mark_document_embedding_error(conn, doc_id, f"all_chunks_failed ({result['total_chunks']} chunks)", commit=False)

    # Single commit for all status updates
    conn.commit()
    logger.info(f"Batch complete. Total: {len(documents)} docs, {total_chunks_embedded} chunks")
    return len(documents), total_chunks_embedded


def get_stats(conn) -> dict:
    """Get embedding statistics."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
                COUNT(CASE WHEN metadata->>'embedding_v2' = 'completed' THEN 1 END) as has_embedding_v2,
                COUNT(CASE WHEN metadata->>'embedding_v2_error' IS NOT NULL THEN 1 END) as errors_v2
            FROM documents
            WHERE filename LIKE '%%.pdf'
        """)
        return cur.fetchone()


def main():
    """Main processing loop."""
    logger.info(f"Starting Embedding Generator Worker {WORKER_ID}")
    logger.info(f"Using OpenAI model: {OPENAI_MODEL} ({EMBEDDING_DIMENSION} dimensions)")
    logger.info(f"Qdrant collection: {QDRANT_COLLECTION}")
    logger.info(f"Batch size: {BATCH_SIZE}")
    logger.info(f"Rate limit: {REQUESTS_PER_MINUTE} requests/min")
    logger.info(f"Chunking: {CHUNK_SIZE} chars with {CHUNK_OVERLAP} overlap, max {MAX_CHUNKS_PER_DOC} chunks/doc")

    if not OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY not configured")
        sys.exit(1)

    conn = get_db_connection()
    qdrant_client = get_qdrant_client()
    rate_limiter = RateLimiter(REQUESTS_PER_MINUTE)

    # Ensure collection exists
    ensure_collection(qdrant_client)

    # Print initial stats
    stats = get_stats(conn)
    logger.info(f"Initial stats: {stats}")

    total_docs_processed = 0
    total_chunks_embedded = 0
    consecutive_empty = 0

    while True:
        try:
            docs_processed, chunks_embedded = process_batch(conn, qdrant_client, rate_limiter)
            total_docs_processed += docs_processed
            total_chunks_embedded += chunks_embedded

            if docs_processed == 0:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    logger.info(f"No documents to embed. Total: {total_docs_processed} docs, {total_chunks_embedded} chunks. Waiting 30s...")
                    time.sleep(30)
                else:
                    time.sleep(5)
            else:
                consecutive_empty = 0
                logger.info(f"Batch complete. Total: {total_docs_processed} docs, {total_chunks_embedded} chunks")

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
