#!/usr/bin/env python3
"""
Upload PDFs to Hetzner Object Storage (S3-compatible)

Usage:
    python upload_to_hetzner.py /path/to/pdfs dataset_10

Environment variables required:
    HETZNER_S3_ENDPOINT - e.g., https://fsn1.your-objectstorage.com
    HETZNER_S3_ACCESS_KEY
    HETZNER_S3_SECRET_KEY
    HETZNER_S3_BUCKET - e.g., epstein-documents
"""

import os
import sys
import boto3
from botocore.config import Config
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import psycopg2
from psycopg2.extras import execute_batch
import logging
import time

# Configuration
S3_ENDPOINT = os.environ.get('HETZNER_S3_ENDPOINT', 'https://fsn1.your-objectstorage.com')
S3_ACCESS_KEY = os.environ.get('HETZNER_S3_ACCESS_KEY', '')
S3_SECRET_KEY = os.environ.get('HETZNER_S3_SECRET_KEY', '')
S3_BUCKET = os.environ.get('HETZNER_S3_BUCKET', 'epstein-documents')
S3_REGION = os.environ.get('HETZNER_S3_REGION', 'fsn1')

# PostgreSQL
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

# Upload settings
MAX_WORKERS = int(os.environ.get('UPLOAD_WORKERS', 20))
BATCH_SIZE = 100

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_s3_client():
    """Create S3 client for Hetzner Object Storage."""
    return boto3.client(
        's3',
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=Config(
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'adaptive'}
        )
    )


def compute_hash(filepath: Path) -> str:
    """Compute MD5 hash of file."""
    hash_md5 = hashlib.md5()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def upload_file(s3_client, filepath: Path, s3_key: str) -> dict:
    """Upload a single file to S3."""
    try:
        file_size = filepath.stat().st_size
        s3_client.upload_file(
            str(filepath),
            S3_BUCKET,
            s3_key,
            ExtraArgs={'ContentType': 'application/pdf'}
        )
        return {
            'success': True,
            'filepath': str(filepath),
            's3_key': s3_key,
            'size': file_size
        }
    except Exception as e:
        return {
            'success': False,
            'filepath': str(filepath),
            's3_key': s3_key,
            'error': str(e)
        }


def get_existing_keys(s3_client, prefix: str) -> set:
    """Get set of existing S3 keys with given prefix."""
    existing = set()
    paginator = s3_client.get_paginator('list_objects_v2')

    try:
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
            for obj in page.get('Contents', []):
                existing.add(obj['Key'])
    except Exception as e:
        logger.warning(f"Could not list existing keys: {e}")

    return existing


def update_database(conn, updates: list):
    """Update database with S3 keys."""
    if not updates:
        return

    with conn.cursor() as cur:
        execute_batch(cur, """
            UPDATE documents
            SET metadata = jsonb_set(
                jsonb_set(
                    COALESCE(metadata, '{}'),
                    '{s3_key}', %s::jsonb
                ),
                '{s3_uploaded}', 'true'::jsonb
            )
            WHERE filename = %s AND source = %s
        """, [(f'"{u["s3_key"]}"', u['filename'], u['source']) for u in updates])
        conn.commit()
        logger.info(f"Updated {len(updates)} database records with S3 keys")


def main():
    if len(sys.argv) < 3:
        print("Usage: python upload_to_hetzner.py <pdf_directory> <source_name>")
        print("Example: python upload_to_hetzner.py /data/DataSet_10_extracted dataset_10")
        sys.exit(1)

    pdf_dir = Path(sys.argv[1])
    source = sys.argv[2]

    if not pdf_dir.exists():
        logger.error(f"Directory not found: {pdf_dir}")
        sys.exit(1)

    if not S3_ACCESS_KEY or not S3_SECRET_KEY:
        logger.error("Missing S3 credentials. Set HETZNER_S3_ACCESS_KEY and HETZNER_S3_SECRET_KEY")
        sys.exit(1)

    # Initialize clients
    s3_client = get_s3_client()
    conn = psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        database=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD
    )

    # Get existing S3 keys to skip already uploaded files
    logger.info(f"Checking existing files in s3://{S3_BUCKET}/{source}/...")
    existing_keys = get_existing_keys(s3_client, f"{source}/")
    logger.info(f"Found {len(existing_keys)} existing files in S3")

    # Find all PDFs
    logger.info(f"Scanning {pdf_dir} for PDFs...")
    pdf_files = list(pdf_dir.rglob("*.pdf")) + list(pdf_dir.rglob("*.PDF"))
    logger.info(f"Found {len(pdf_files)} PDF files")

    # Filter out already uploaded
    to_upload = []
    for pdf_path in pdf_files:
        filename = pdf_path.name
        content_hash = compute_hash(pdf_path)[:4]
        s3_key = f"{source}/{content_hash}/{filename}"

        if s3_key not in existing_keys:
            to_upload.append({
                'filepath': pdf_path,
                's3_key': s3_key,
                'filename': filename,
                'source': source
            })

    logger.info(f"Need to upload {len(to_upload)} files ({len(pdf_files) - len(to_upload)} already exist)")

    if not to_upload:
        logger.info("Nothing to upload!")
        return

    # Upload with thread pool
    uploaded = 0
    failed = 0
    db_updates = []
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(upload_file, s3_client, item['filepath'], item['s3_key']): item
            for item in to_upload
        }

        for future in as_completed(futures):
            item = futures[future]
            result = future.result()

            if result['success']:
                uploaded += 1
                db_updates.append({
                    's3_key': result['s3_key'],
                    'filename': item['filename'],
                    'source': item['source']
                })

                # Batch database updates
                if len(db_updates) >= BATCH_SIZE:
                    update_database(conn, db_updates)
                    db_updates = []
            else:
                failed += 1
                logger.warning(f"Failed to upload {item['filename']}: {result['error']}")

            # Progress update
            total_done = uploaded + failed
            if total_done % 100 == 0:
                elapsed = time.time() - start_time
                rate = total_done / elapsed if elapsed > 0 else 0
                remaining = len(to_upload) - total_done
                eta = remaining / rate if rate > 0 else 0
                logger.info(f"Progress: {total_done}/{len(to_upload)} ({rate:.1f}/sec, ETA: {eta/60:.1f} min)")

    # Final database update
    if db_updates:
        update_database(conn, db_updates)

    conn.close()

    elapsed = time.time() - start_time
    logger.info(f"Upload complete: {uploaded} uploaded, {failed} failed in {elapsed/60:.1f} minutes")


if __name__ == '__main__':
    main()
