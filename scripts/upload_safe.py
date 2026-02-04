#!/usr/bin/env python3
"""
Safe R2 Uploader - Uploads PDFs to Cloudflare R2 with verification.

SAFE MODE: NEVER deletes local files. Only updates r2_key after verified upload.

Usage:
    python3 upload_safe.py /path/to/pdfs dataset_name [--limit 1000]

Environment variables required:
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
    PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
"""

import os
import sys
import time
import hashlib
import json
import argparse
import logging
from pathlib import Path
from typing import Optional, Tuple, List
import psycopg2
from psycopg2.extras import RealDictCursor
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# Configuration from environment
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

R2_ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID', '')
R2_ACCESS_KEY_ID = os.environ.get('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = os.environ.get('R2_SECRET_ACCESS_KEY', '')
R2_BUCKET = os.environ.get('R2_BUCKET', 'epstein-documents')

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
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


def compute_file_hash(file_path: Path) -> str:
    """Compute MD5 hash of file."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def generate_r2_key(filename: str, source: str, content_hash: str) -> str:
    """Generate R2 object key based on source and filename."""
    hash_prefix = content_hash[:4]
    return f"{source}/{hash_prefix}/{filename}"


def upload_to_r2(s3_client, file_path: Path, r2_key: str, content_hash: str) -> Tuple[bool, Optional[str]]:
    """Upload file to R2 with verification."""
    try:
        file_size = file_path.stat().st_size

        extra_args = {
            'ContentType': 'application/pdf',
            'Metadata': {
                'content_hash': content_hash,
                'original_filename': file_path.name,
                'upload_timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
            }
        }

        s3_client.upload_file(
            str(file_path),
            R2_BUCKET,
            r2_key,
            ExtraArgs=extra_args
        )

        # Verify upload
        response = s3_client.head_object(Bucket=R2_BUCKET, Key=r2_key)
        if response['ContentLength'] != file_size:
            return False, f"Size mismatch: {response['ContentLength']} vs {file_size}"

        return True, None

    except ClientError as e:
        return False, str(e)
    except Exception as e:
        return False, str(e)


def check_r2_exists(s3_client, r2_key: str) -> bool:
    """Check if object exists in R2."""
    try:
        s3_client.head_object(Bucket=R2_BUCKET, Key=r2_key)
        return True
    except ClientError:
        return False


def find_pdf_files(directory: Path) -> List[Path]:
    """Find all PDF files in directory."""
    return list(directory.rglob('*.pdf')) + list(directory.rglob('*.PDF'))


def update_document_r2_key(conn, filename: str, source: str, r2_key: str, content_hash: str, file_size: int):
    """Update document in database with R2 key."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET r2_key = %s,
                content_hash = COALESCE(content_hash, %s),
                metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('r2_upload_completed', %s, 'r2_file_size', %s),
                updated_at = NOW()
            WHERE filename = %s AND source = %s
            RETURNING id
        """, (r2_key, content_hash, time.strftime('%Y-%m-%dT%H:%M:%SZ'), file_size, filename, source))
        result = cur.fetchone()
        conn.commit()
        return result[0] if result else None


def register_new_document(conn, filename: str, source: str, r2_key: str, content_hash: str, file_size: int):
    """Register a new document if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id FROM documents WHERE filename = %s AND source = %s
        """, (filename, source))
        if cur.fetchone():
            return None  # Already exists

        cur.execute("""
            INSERT INTO documents (filename, source, r2_key, content_hash, metadata, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (content_hash) DO UPDATE SET
                r2_key = EXCLUDED.r2_key,
                updated_at = NOW()
            RETURNING id
        """, (filename, source, r2_key, content_hash,
              json.dumps({'r2_file_size': file_size, 'r2_upload_completed': time.strftime('%Y-%m-%dT%H:%M:%SZ')})))
        result = cur.fetchone()
        conn.commit()
        return result[0] if result else None


def main():
    parser = argparse.ArgumentParser(description='Safe R2 uploader - uploads PDFs without deleting local files')
    parser.add_argument('directory', type=Path, help='Directory containing PDFs')
    parser.add_argument('source', type=str, help='Source name (e.g., dataset_10)')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of files to process (0 = unlimited)')
    parser.add_argument('--skip-existing', action='store_true', help='Skip files already in R2')
    parser.add_argument('--register-only', action='store_true', help='Only register in DB, skip R2 upload')

    args = parser.parse_args()

    if not args.directory.exists():
        logger.error(f"Directory not found: {args.directory}")
        sys.exit(1)

    if not R2_ACCOUNT_ID or not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
        logger.error("R2 credentials not set. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
        sys.exit(1)

    logger.info(f"Scanning {args.directory} for PDFs...")
    pdf_files = find_pdf_files(args.directory)
    logger.info(f"Found {len(pdf_files)} PDF files")

    if args.limit > 0:
        pdf_files = pdf_files[:args.limit]
        logger.info(f"Processing first {args.limit} files")

    conn = get_db_connection()
    s3_client = get_s3_client()

    # Test R2 connection
    try:
        s3_client.head_bucket(Bucket=R2_BUCKET)
        logger.info(f"R2 bucket {R2_BUCKET} accessible")
    except Exception as e:
        logger.error(f"Cannot access R2 bucket: {e}")
        sys.exit(1)

    uploaded = 0
    skipped = 0
    errors = 0

    for i, pdf_path in enumerate(pdf_files, 1):
        filename = pdf_path.name

        try:
            # Compute hash
            content_hash = compute_file_hash(pdf_path)
            file_size = pdf_path.stat().st_size
            r2_key = generate_r2_key(filename, args.source, content_hash)

            # Check if already in R2
            if args.skip_existing and check_r2_exists(s3_client, r2_key):
                logger.debug(f"[{i}/{len(pdf_files)}] Already in R2: {filename}")
                skipped += 1
                # Update DB anyway
                doc_id = update_document_r2_key(conn, filename, args.source, r2_key, content_hash, file_size)
                if not doc_id:
                    doc_id = register_new_document(conn, filename, args.source, r2_key, content_hash, file_size)
                continue

            if args.register_only:
                # Just register in DB without uploading
                doc_id = register_new_document(conn, filename, args.source, r2_key, content_hash, file_size)
                if doc_id:
                    logger.info(f"[{i}/{len(pdf_files)}] Registered: {filename}")
                    uploaded += 1
                else:
                    skipped += 1
                continue

            # Upload to R2
            success, error = upload_to_r2(s3_client, pdf_path, r2_key, content_hash)

            if success:
                # Update database
                doc_id = update_document_r2_key(conn, filename, args.source, r2_key, content_hash, file_size)
                if not doc_id:
                    doc_id = register_new_document(conn, filename, args.source, r2_key, content_hash, file_size)

                logger.info(f"[{i}/{len(pdf_files)}] Uploaded: {filename} -> {r2_key}")
                uploaded += 1
            else:
                logger.error(f"[{i}/{len(pdf_files)}] Failed: {filename}: {error}")
                errors += 1

        except Exception as e:
            logger.error(f"[{i}/{len(pdf_files)}] Error processing {filename}: {e}")
            errors += 1

        # Progress update every 100 files
        if i % 100 == 0:
            logger.info(f"Progress: {i}/{len(pdf_files)} ({uploaded} uploaded, {skipped} skipped, {errors} errors)")

    conn.close()

    logger.info(f"Complete: {uploaded} uploaded, {skipped} skipped, {errors} errors")


if __name__ == '__main__':
    main()
