#!/usr/bin/env python3
"""
R2 Uploader - Uploads PDFs to Cloudflare R2 with verification.

SAFE MODE: NEVER deletes local files. Only updates r2_key after verified upload.

Uses FOR UPDATE SKIP LOCKED for atomic document claiming across multiple workers.
"""

import os
import sys
import time
import hashlib
import json
import logging
from pathlib import Path
from typing import Optional, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# Configuration
PG_HOST = os.environ.get('PG_HOST', 'postgres')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')
DATA_DIR = os.environ.get('DATA_DIR', '/data')
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 50))
WORKER_ID = os.environ.get('WORKER_ID', '1')

# R2 Configuration
R2_ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID', '')
R2_ACCESS_KEY_ID = os.environ.get('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = os.environ.get('R2_SECRET_ACCESS_KEY', '')
R2_BUCKET = os.environ.get('R2_BUCKET', 'epstein-documents')

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format=f'[R2-Worker-{WORKER_ID}] %(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        database=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD
    )


def get_s3_client():
    """Create an S3 client configured for Cloudflare R2."""
    return boto3.client(
        's3',
        endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(
            signature_version='s3v4',
            retries={'max_attempts': 3}
        )
    )


def find_pdf_on_disk(filename: str, source: str) -> Optional[Path]:
    """
    Try to find the PDF file on disk.
    """
    data_path = Path(DATA_DIR)

    source_dirs = {
        'dataset_9': ['datasets-2026/DataSet_9_extracted', 'DataSet_9'],
        'dataset_10': ['datasets-2026/DataSet_10_extracted', 'DataSet_10'],
        'dataset_11': ['datasets-2026/DataSet_11_extracted', 'DataSet_11'],
        'dataset_12': ['datasets-2026/DataSet_12_extracted', 'DataSet_12'],
    }

    dirs_to_check = source_dirs.get(source, [])
    dirs_to_check.extend(['', 'pdfs', 'documents'])

    for dir_pattern in dirs_to_check:
        search_path = data_path / dir_pattern / filename if dir_pattern else data_path / filename
        if search_path.exists():
            return search_path

        if dir_pattern:
            base_dir = data_path / dir_pattern
            if base_dir.exists():
                for f in base_dir.rglob(filename):
                    return f

    return None


def compute_file_hash(file_path: Path) -> str:
    """Compute MD5 hash of file."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def generate_r2_key(filename: str, source: str, content_hash: str) -> str:
    """Generate R2 object key based on source and filename."""
    # Use format: {source}/{hash_prefix}/{filename}
    # This spreads files across directories for better performance
    hash_prefix = content_hash[:4]
    return f"{source}/{hash_prefix}/{filename}"


def upload_to_r2(s3_client, file_path: Path, r2_key: str, content_hash: str) -> Tuple[bool, Optional[str]]:
    """
    Upload file to R2 with verification.
    Returns (success, error_message).
    """
    try:
        file_size = file_path.stat().st_size

        # Upload with metadata
        extra_args = {
            'ContentType': 'application/pdf',
            'Metadata': {
                'content_hash': content_hash,
                'original_filename': file_path.name,
                'upload_timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
            }
        }

        logger.info(f"Uploading {file_path.name} ({file_size} bytes) to {r2_key}")

        s3_client.upload_file(
            str(file_path),
            R2_BUCKET,
            r2_key,
            ExtraArgs=extra_args
        )

        # Verify upload with HEAD request
        response = s3_client.head_object(Bucket=R2_BUCKET, Key=r2_key)

        if response['ContentLength'] != file_size:
            return False, f"Size mismatch: uploaded {response['ContentLength']}, expected {file_size}"

        return True, None

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        return False, f"R2 error ({error_code}): {str(e)}"
    except Exception as e:
        return False, str(e)


def check_r2_exists(s3_client, r2_key: str) -> bool:
    """Check if object already exists in R2."""
    try:
        s3_client.head_object(Bucket=R2_BUCKET, Key=r2_key)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            return False
        raise


def claim_documents(conn, limit: int) -> list:
    """
    Claim documents for R2 upload using FOR UPDATE SKIP LOCKED.
    Returns list of document records.

    Handles two cases:
    1. Documents with no r2_key - need to upload
    2. Documents with r2_key but not verified - need to verify/upload if missing
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Find documents that need R2 upload or verification:
        # - Have a filename
        # - Either no r2_key OR r2_key exists but not verified
        # - Not marked as file_not_found or upload error
        # - Prioritize 2026 datasets (have files on disk)
        cur.execute("""
            WITH claimed AS (
                SELECT id, filename, source, r2_key, content_hash, metadata
                FROM documents
                WHERE filename IS NOT NULL
                  AND filename LIKE '%%.pdf'
                  AND (
                      (r2_key IS NULL OR r2_key = '')
                      OR (r2_key IS NOT NULL AND r2_key != '' AND (metadata IS NULL OR metadata->>'r2_verified' IS NULL))
                  )
                  AND (metadata IS NULL OR metadata->>'file_not_found' IS NULL)
                  AND (metadata IS NULL OR metadata->>'r2_upload_error' IS NULL)
                ORDER BY
                    CASE
                        WHEN source IN ('dataset_10', 'dataset_9', 'dataset_11', 'dataset_12') THEN 0
                        ELSE 1
                    END,
                    created_at ASC
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents d
            SET metadata = COALESCE(d.metadata, '{}'::jsonb) ||
                           jsonb_build_object('r2_upload_started', NOW()::text, 'r2_worker_id', %s)
            FROM claimed c
            WHERE d.id = c.id
            RETURNING d.id, d.filename, d.source, d.r2_key, d.content_hash, d.metadata
        """, (limit, WORKER_ID))

        conn.commit()
        return cur.fetchall()


def update_document_r2_key(conn, doc_id: str, r2_key: str, content_hash: str, file_size: int):
    """Update document with R2 key after successful upload or verification."""
    with conn.cursor() as cur:
        metadata_update = {
            'r2_upload_completed': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'r2_worker_id': WORKER_ID,
            'r2_file_size': file_size,
            'r2_verified': True  # Mark as verified in R2
        }

        cur.execute("""
            UPDATE documents
            SET r2_key = %s,
                content_hash = COALESCE(content_hash, %s),
                metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                processed_at = NOW()
            WHERE id = %s
        """, (r2_key, content_hash, json.dumps(metadata_update), doc_id))

        conn.commit()


def mark_document_upload_error(conn, doc_id: str, error: str):
    """Mark document with upload error."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('r2_upload_error', %s, 'r2_worker_id', %s),
                processed_at = NOW()
            WHERE id = %s
        """, (error, WORKER_ID, doc_id))
        conn.commit()


def mark_document_file_not_found(conn, doc_id: str):
    """Mark document as file not found."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('file_not_found', true, 'r2_worker_id', %s),
                processed_at = NOW()
            WHERE id = %s
        """, (WORKER_ID, doc_id))
        conn.commit()


def process_batch(conn, s3_client) -> int:
    """
    Process a batch of documents for R2 upload.
    Returns number of documents processed.
    """
    documents = claim_documents(conn, BATCH_SIZE)

    if not documents:
        return 0

    logger.info(f"Processing batch of {len(documents)} documents for R2 upload")

    processed = 0
    for doc in documents:
        doc_id = str(doc['id'])
        filename = doc['filename']
        source = doc['source']
        existing_hash = doc.get('content_hash')

        # Find PDF on disk
        pdf_path = find_pdf_on_disk(filename, source)

        if not pdf_path:
            logger.warning(f"File not found: {filename} (source: {source})")
            mark_document_file_not_found(conn, doc_id)
            continue

        # Compute hash if not already set
        content_hash = existing_hash or compute_file_hash(pdf_path)

        # Generate R2 key
        r2_key = generate_r2_key(filename, source, content_hash)

        # Check if already exists in R2
        if check_r2_exists(s3_client, r2_key):
            logger.info(f"Already in R2: {r2_key}")
            file_size = pdf_path.stat().st_size
            update_document_r2_key(conn, doc_id, r2_key, content_hash, file_size)
            processed += 1
            continue

        # Upload to R2
        success, error = upload_to_r2(s3_client, pdf_path, r2_key, content_hash)

        if success:
            file_size = pdf_path.stat().st_size
            update_document_r2_key(conn, doc_id, r2_key, content_hash, file_size)
            logger.info(f"Uploaded: {filename} -> {r2_key}")
        else:
            logger.error(f"Upload failed for {filename}: {error}")
            mark_document_upload_error(conn, doc_id, error)

        processed += 1

    return processed


def get_stats(conn) -> dict:
    """Get upload statistics."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN r2_key IS NOT NULL AND r2_key != '' THEN 1 END) as has_r2_key,
                COUNT(CASE WHEN metadata->>'r2_verified' = 'true' THEN 1 END) as r2_verified,
                COUNT(CASE WHEN metadata->>'r2_upload_error' IS NOT NULL THEN 1 END) as upload_errors,
                COUNT(CASE WHEN metadata->>'file_not_found' = 'true' THEN 1 END) as not_found
            FROM documents
            WHERE filename LIKE '%%.pdf'
        """)
        return cur.fetchone()


def main():
    """Main processing loop."""
    logger.info(f"Starting R2 Uploader Worker {WORKER_ID}")
    logger.info(f"Data directory: {DATA_DIR}")
    logger.info(f"R2 Bucket: {R2_BUCKET}")
    logger.info(f"Batch size: {BATCH_SIZE}")

    if not R2_ACCOUNT_ID or not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
        logger.error("R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
        sys.exit(1)

    conn = get_db_connection()
    s3_client = get_s3_client()

    # Test R2 connection
    try:
        s3_client.head_bucket(Bucket=R2_BUCKET)
        logger.info(f"R2 bucket {R2_BUCKET} accessible")
    except Exception as e:
        logger.error(f"Cannot access R2 bucket: {e}")
        sys.exit(1)

    # Print initial stats
    stats = get_stats(conn)
    logger.info(f"Initial stats: {stats}")

    total_processed = 0
    consecutive_empty = 0

    while True:
        try:
            processed = process_batch(conn, s3_client)
            total_processed += processed

            if processed == 0:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    logger.info(f"No documents to upload. Total processed: {total_processed}. Waiting 30s...")
                    time.sleep(30)
                else:
                    time.sleep(5)
            else:
                consecutive_empty = 0
                logger.info(f"Batch complete. Total processed: {total_processed}")
                time.sleep(1)

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
