#!/usr/bin/env python3
"""
Embedding Generator - Generates embeddings via Cloudflare Workers AI REST API.

Can run standalone or in Docker container.

Usage:
    python3 generate_embeddings.py --batch-size 10 --source dataset_10

Environment variables required:
    CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
    PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
    QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY
"""

import os
import sys
import time
import json
import argparse
import logging
import uuid
from typing import Optional, List, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance

# Configuration
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

QDRANT_HOST = os.environ.get('QDRANT_HOST', 'localhost')
QDRANT_PORT = int(os.environ.get('QDRANT_PORT', 6333))
QDRANT_API_KEY = os.environ.get('QDRANT_API_KEY', '')
QDRANT_COLLECTION = os.environ.get('QDRANT_COLLECTION', 'document_embeddings')

CLOUDFLARE_ACCOUNT_ID = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
CLOUDFLARE_API_TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')

EMBEDDING_DIMENSION = 768
MODEL_ID = '@cf/baai/bge-base-en-v1.5'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self, requests_per_minute: int):
        self.interval = 60.0 / requests_per_minute
        self.last_request = 0

    def wait(self):
        now = time.time()
        elapsed = now - self.last_request
        if elapsed < self.interval:
            time.sleep(self.interval - elapsed)
        self.last_request = time.time()


def get_db_connection():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, database=PG_DATABASE,
        user=PG_USER, password=PG_PASSWORD
    )


def get_qdrant_client():
    return QdrantClient(
        host=QDRANT_HOST, port=QDRANT_PORT,
        api_key=QDRANT_API_KEY if QDRANT_API_KEY else None
    )


def ensure_collection(qdrant_client):
    collections = qdrant_client.get_collections().collections
    if QDRANT_COLLECTION not in [c.name for c in collections]:
        logger.info(f"Creating collection {QDRANT_COLLECTION}")
        qdrant_client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=EMBEDDING_DIMENSION, distance=Distance.COSINE)
        )


def generate_embedding(text: str, rate_limiter: RateLimiter) -> Tuple[Optional[List[float]], Optional[str]]:
    rate_limiter.wait()

    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{MODEL_ID}"
    headers = {
        'Authorization': f'Bearer {CLOUDFLARE_API_TOKEN}',
        'Content-Type': 'application/json'
    }

    truncated_text = text[:2000]
    payload = {'text': [truncated_text]}

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code == 429:
            logger.warning("Rate limited, waiting 60s...")
            time.sleep(60)
            return None, "rate_limited"

        if response.status_code != 200:
            return None, f"API error {response.status_code}"

        result = response.json()
        if not result.get('success'):
            return None, str(result.get('errors', []))

        data = result.get('result', {}).get('data', [])
        if not data:
            return None, "No embedding in response"

        return data[0], None

    except Exception as e:
        return None, str(e)


def claim_documents(conn, limit: int, source: Optional[str] = None) -> list:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        source_filter = "AND source = %s" if source else ""
        params = [limit]
        if source:
            params.insert(0, source)

        query = f"""
            WITH claimed AS (
                SELECT id, filename, source, metadata
                FROM documents
                WHERE metadata->>'text' IS NOT NULL
                  AND LENGTH(metadata->>'text') > 100
                  AND (embedding_status IS NULL OR embedding_status = 'pending')
                  AND (metadata IS NULL OR metadata->>'embedding_error' IS NULL)
                  {source_filter}
                ORDER BY created_at ASC
                LIMIT {'%s' if not source else '%s'}
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents d
            SET embedding_status = 'processing'
            FROM claimed c
            WHERE d.id = c.id
            RETURNING d.id, d.filename, d.source, d.metadata
        """

        if source:
            cur.execute(query, (source, limit))
        else:
            cur.execute(query, (limit,))

        conn.commit()
        return cur.fetchall()


def update_embedding_status(conn, doc_id: str, status: str, point_id: Optional[str] = None):
    with conn.cursor() as cur:
        metadata = {'embedding_completed': time.strftime('%Y-%m-%dT%H:%M:%SZ')}
        if point_id:
            metadata['qdrant_point_id'] = point_id

        cur.execute("""
            UPDATE documents
            SET embedding_status = %s,
                metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                updated_at = NOW()
            WHERE id = %s
        """, (status, json.dumps(metadata), doc_id))
        conn.commit()


def mark_error(conn, doc_id: str, error: str):
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET embedding_status = 'error',
                metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('embedding_error', %s),
                updated_at = NOW()
            WHERE id = %s
        """, (error, doc_id))
        conn.commit()


def store_embedding(qdrant_client, doc_id: str, embedding: List[float], filename: str, source: str) -> str:
    point_id = str(uuid.UUID(doc_id).int % (10**18))
    point = PointStruct(
        id=int(point_id),
        vector=embedding,
        payload={'document_id': doc_id, 'filename': filename, 'source': source}
    )
    qdrant_client.upsert(collection_name=QDRANT_COLLECTION, points=[point])
    return point_id


def main():
    parser = argparse.ArgumentParser(description='Generate embeddings for documents')
    parser.add_argument('--batch-size', type=int, default=10, help='Batch size')
    parser.add_argument('--source', type=str, help='Filter by source')
    parser.add_argument('--requests-per-minute', type=int, default=300, help='API rate limit')
    parser.add_argument('--continuous', action='store_true', help='Run continuously')

    args = parser.parse_args()

    if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
        logger.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN")
        sys.exit(1)

    conn = get_db_connection()
    qdrant = get_qdrant_client()
    rate_limiter = RateLimiter(args.requests_per_minute)

    ensure_collection(qdrant)

    total = 0
    while True:
        docs = claim_documents(conn, args.batch_size, args.source)

        if not docs:
            if args.continuous:
                logger.info(f"No documents. Total: {total}. Waiting 30s...")
                time.sleep(30)
                continue
            else:
                break

        for doc in docs:
            doc_id = str(doc['id'])
            text = (doc['metadata'] or {}).get('text', '')

            if len(text) < 100:
                mark_error(conn, doc_id, 'insufficient_text')
                continue

            embedding, error = generate_embedding(text, rate_limiter)

            if error == "rate_limited":
                continue

            if error:
                mark_error(conn, doc_id, error)
                total += 1
                continue

            try:
                point_id = store_embedding(qdrant, doc_id, embedding, doc['filename'], doc['source'])
                update_embedding_status(conn, doc_id, 'completed', point_id)
                logger.info(f"Embedded: {doc['filename']}")
            except Exception as e:
                mark_error(conn, doc_id, str(e))

            total += 1

        logger.info(f"Batch complete. Total: {total}")

        if not args.continuous:
            break

    conn.close()
    logger.info(f"Done. Total processed: {total}")


if __name__ == '__main__':
    main()
