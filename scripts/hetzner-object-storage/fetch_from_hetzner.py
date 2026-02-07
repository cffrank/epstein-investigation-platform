#!/usr/bin/env python3
"""
Fetch PDFs from Hetzner Object Storage (S3-compatible)

This module can be imported by the text-extractor workers to fetch files
from Hetzner Object Storage instead of local disk or R2.

Environment variables:
    HETZNER_S3_ENDPOINT - e.g., https://fsn1.your-objectstorage.com
    HETZNER_S3_ACCESS_KEY
    HETZNER_S3_SECRET_KEY
    HETZNER_S3_BUCKET - e.g., epstein-documents
"""

import os
import tempfile
import logging
from pathlib import Path
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Configuration
S3_ENDPOINT = os.environ.get('HETZNER_S3_ENDPOINT', '')
S3_ACCESS_KEY = os.environ.get('HETZNER_S3_ACCESS_KEY', '')
S3_SECRET_KEY = os.environ.get('HETZNER_S3_SECRET_KEY', '')
S3_BUCKET = os.environ.get('HETZNER_S3_BUCKET', 'epstein-documents')
S3_REGION = os.environ.get('HETZNER_S3_REGION', 'fsn1')

_s3_client = None


def get_s3_client():
    """Get or create S3 client (singleton)."""
    global _s3_client
    if _s3_client is None and S3_ENDPOINT and S3_ACCESS_KEY:
        _s3_client = boto3.client(
            's3',
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION,
            config=Config(
                signature_version='s3v4',
                retries={'max_attempts': 3, 'mode': 'adaptive'},
                max_pool_connections=50
            )
        )
    return _s3_client


def is_configured() -> bool:
    """Check if Hetzner S3 is configured."""
    return bool(S3_ENDPOINT and S3_ACCESS_KEY and S3_SECRET_KEY)


def fetch_file(s3_key: str) -> Optional[Path]:
    """
    Fetch a file from Hetzner Object Storage.

    Args:
        s3_key: The S3 key (e.g., 'dataset_10/ab12/filename.pdf')

    Returns:
        Path to temporary file, or None if fetch failed.
        Caller is responsible for cleaning up the temp file.
    """
    client = get_s3_client()
    if not client:
        logger.debug("Hetzner S3 not configured")
        return None

    try:
        # Create temp file with .pdf extension
        fd, temp_path = tempfile.mkstemp(suffix='.pdf')
        os.close(fd)

        client.download_file(S3_BUCKET, s3_key, temp_path)
        logger.debug(f"Fetched from Hetzner S3: {s3_key}")
        return Path(temp_path)

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == '404' or error_code == 'NoSuchKey':
            logger.debug(f"File not found in Hetzner S3: {s3_key}")
        else:
            logger.warning(f"Error fetching from Hetzner S3: {e}")

        # Clean up temp file on error
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.unlink(temp_path)
        return None

    except Exception as e:
        logger.warning(f"Unexpected error fetching from Hetzner S3: {e}")
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.unlink(temp_path)
        return None


def file_exists(s3_key: str) -> bool:
    """Check if a file exists in Hetzner Object Storage."""
    client = get_s3_client()
    if not client:
        return False

    try:
        client.head_object(Bucket=S3_BUCKET, Key=s3_key)
        return True
    except ClientError:
        return False


def list_files(prefix: str, max_keys: int = 1000) -> list:
    """List files with given prefix."""
    client = get_s3_client()
    if not client:
        return []

    try:
        response = client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=prefix,
            MaxKeys=max_keys
        )
        return [obj['Key'] for obj in response.get('Contents', [])]
    except Exception as e:
        logger.warning(f"Error listing files: {e}")
        return []
