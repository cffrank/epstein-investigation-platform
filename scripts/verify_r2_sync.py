#!/usr/bin/env python3
"""
Verify R2 Sync - Checks that R2 uploads match database records.

Usage:
    python3 verify_r2_sync.py [--fix] [--source dataset_10]

This script:
1. Compares R2 objects with PostgreSQL r2_key records
2. Identifies missing uploads (in DB but not R2)
3. Identifies orphaned R2 objects (in R2 but not DB)
4. Optionally fixes mismatches

Environment variables:
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
    PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
"""

import os
import sys
import argparse
import logging
from collections import defaultdict
import psycopg2
from psycopg2.extras import RealDictCursor
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# Configuration
PG_HOST = os.environ.get('PG_HOST', 'localhost')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

R2_ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID', '')
R2_ACCESS_KEY_ID = os.environ.get('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = os.environ.get('R2_SECRET_ACCESS_KEY', '')
R2_BUCKET = os.environ.get('R2_BUCKET', 'epstein-documents')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_db_connection():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, database=PG_DATABASE,
        user=PG_USER, password=PG_PASSWORD
    )


def get_s3_client():
    return boto3.client(
        's3',
        endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4')
    )


def list_r2_objects(s3_client, prefix: str = None):
    """List all objects in R2 bucket."""
    objects = {}
    paginator = s3_client.get_paginator('list_objects_v2')

    params = {'Bucket': R2_BUCKET}
    if prefix:
        params['Prefix'] = prefix

    for page in paginator.paginate(**params):
        for obj in page.get('Contents', []):
            objects[obj['Key']] = {
                'size': obj['Size'],
                'last_modified': obj['LastModified']
            }

    return objects


def get_db_r2_keys(conn, source: str = None):
    """Get all r2_keys from database."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if source:
            cur.execute("""
                SELECT id, filename, source, r2_key, content_hash
                FROM documents
                WHERE r2_key IS NOT NULL AND r2_key != ''
                  AND source = %s
            """, (source,))
        else:
            cur.execute("""
                SELECT id, filename, source, r2_key, content_hash
                FROM documents
                WHERE r2_key IS NOT NULL AND r2_key != ''
            """)
        return {row['r2_key']: row for row in cur.fetchall()}


def clear_invalid_r2_keys(conn, doc_ids: list):
    """Clear r2_key for documents where R2 object doesn't exist."""
    with conn.cursor() as cur:
        for doc_id in doc_ids:
            cur.execute("""
                UPDATE documents
                SET r2_key = NULL,
                    metadata = COALESCE(metadata, '{}'::jsonb) ||
                               jsonb_build_object('r2_key_cleared', NOW()::text)
                WHERE id = %s
            """, (doc_id,))
        conn.commit()


def main():
    parser = argparse.ArgumentParser(description='Verify R2 sync with database')
    parser.add_argument('--source', type=str, help='Filter by source')
    parser.add_argument('--fix', action='store_true', help='Fix mismatches')
    parser.add_argument('--list-orphans', action='store_true', help='List orphaned R2 objects')

    args = parser.parse_args()

    if not R2_ACCOUNT_ID or not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
        logger.error("R2 credentials not set")
        sys.exit(1)

    conn = get_db_connection()
    s3_client = get_s3_client()

    # Get data
    logger.info("Fetching R2 objects...")
    r2_prefix = f"{args.source}/" if args.source else None
    r2_objects = list_r2_objects(s3_client, r2_prefix)
    logger.info(f"Found {len(r2_objects)} objects in R2")

    logger.info("Fetching database records...")
    db_records = get_db_r2_keys(conn, args.source)
    logger.info(f"Found {len(db_records)} r2_keys in database")

    # Find mismatches
    r2_keys_set = set(r2_objects.keys())
    db_keys_set = set(db_records.keys())

    # In DB but not in R2 (missing uploads)
    missing_in_r2 = db_keys_set - r2_keys_set
    logger.info(f"Missing in R2 (have r2_key but file not found): {len(missing_in_r2)}")

    # In R2 but not in DB (orphaned objects)
    orphaned_in_r2 = r2_keys_set - db_keys_set
    logger.info(f"Orphaned in R2 (no DB record): {len(orphaned_in_r2)}")

    # Matched
    matched = db_keys_set & r2_keys_set
    logger.info(f"Matched (in both DB and R2): {len(matched)}")

    # Summary by source
    if not args.source:
        source_counts = defaultdict(lambda: {'db': 0, 'r2': 0, 'matched': 0, 'missing': 0})
        for key in db_keys_set:
            parts = key.split('/')
            source = parts[0] if len(parts) > 1 else 'unknown'
            source_counts[source]['db'] += 1
            if key in r2_keys_set:
                source_counts[source]['matched'] += 1
            else:
                source_counts[source]['missing'] += 1

        for key in r2_keys_set:
            parts = key.split('/')
            source = parts[0] if len(parts) > 1 else 'unknown'
            source_counts[source]['r2'] += 1

        logger.info("\nBy source:")
        for source, counts in sorted(source_counts.items()):
            logger.info(f"  {source}: DB={counts['db']}, R2={counts['r2']}, Matched={counts['matched']}, Missing={counts['missing']}")

    # Show some examples of missing
    if missing_in_r2:
        logger.info("\nExample missing in R2 (first 10):")
        for key in list(missing_in_r2)[:10]:
            rec = db_records[key]
            logger.info(f"  {key} (doc: {rec['id'][:8]}..., file: {rec['filename']})")

    # Show orphaned if requested
    if args.list_orphans and orphaned_in_r2:
        logger.info("\nOrphaned in R2 (first 50):")
        for key in sorted(orphaned_in_r2)[:50]:
            obj = r2_objects[key]
            logger.info(f"  {key} ({obj['size']} bytes)")

    # Fix if requested
    if args.fix and missing_in_r2:
        logger.info(f"\nClearing {len(missing_in_r2)} invalid r2_keys from database...")
        doc_ids = [db_records[key]['id'] for key in missing_in_r2]
        clear_invalid_r2_keys(conn, doc_ids)
        logger.info("Done. Documents will be re-queued for upload.")

    conn.close()

    # Exit code based on findings
    if missing_in_r2 or orphaned_in_r2:
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()
