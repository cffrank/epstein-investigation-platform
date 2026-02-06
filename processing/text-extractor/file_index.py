#!/usr/bin/env python3
"""
File Index Builder - Scans directories once and builds a fast lookup index.
Stores filename -> full path mappings in a JSON file for fast lookups.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Optional
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

INDEX_FILE = os.environ.get('FILE_INDEX_PATH', '/tmp/file_index.json')
DATA_DIR = os.environ.get('DATA_DIR', '/data')

_file_index: Dict[str, str] = {}
_index_loaded = False


def build_file_index(directories: list = None) -> Dict[str, str]:
    """
    Scan directories and build filename -> path index.
    Returns dict mapping filename to full path.
    """
    global _file_index

    if directories is None:
        directories = [
            # Main data directory (/data)
            ('datasets-2026/DataSet_9_extracted', '/data'),
            ('datasets-2026/DataSet_10_extracted', '/data'),
            ('datasets-2026/DataSet_11_full', '/data'),  # Full DS11 extraction (331K files)
            ('datasets-2026/DataSet_12_extracted', '/data'),
            # Downloads directory (/downloads)
            ('epstein-pdf-nov2025/epstein-pdf', '/downloads'),
            ('epsteindocs', '/downloads'),
            ('epstein-additional', '/downloads'),  # Black book, flight logs, Giuffre batches
        ]

    index = {}
    total_files = 0

    for item in directories:
        if isinstance(item, tuple):
            dir_name, base_path = item
        else:
            dir_name, base_path = item, DATA_DIR

        data_path = Path(base_path)
        dir_path = data_path / dir_name
        if not dir_path.exists():
            logger.warning(f"Directory not found: {dir_path}")
            continue

        logger.info(f"Scanning {dir_path}...")
        start = time.time()
        count = 0

        for pdf_path in dir_path.rglob('*.pdf'):
            filename = pdf_path.name
            # Store the full path
            index[filename] = str(pdf_path)
            count += 1

            if count % 50000 == 0:
                logger.info(f"  Scanned {count} files...")

        elapsed = time.time() - start
        logger.info(f"  Found {count} PDFs in {elapsed:.1f}s")
        total_files += count

    logger.info(f"Total: {total_files} files indexed")
    _file_index = index
    return index


def save_index(index: Dict[str, str], path: str = None):
    """Save index to JSON file."""
    if path is None:
        path = INDEX_FILE

    logger.info(f"Saving index to {path}...")
    with open(path, 'w') as f:
        json.dump(index, f)
    logger.info(f"Index saved ({len(index)} entries)")


def load_index(path: str = None) -> Dict[str, str]:
    """Load index from JSON file."""
    global _file_index, _index_loaded

    if path is None:
        path = INDEX_FILE

    if not os.path.exists(path):
        logger.warning(f"Index file not found: {path}")
        return {}

    logger.info(f"Loading index from {path}...")
    start = time.time()
    with open(path, 'r') as f:
        _file_index = json.load(f)
    elapsed = time.time() - start
    _index_loaded = True
    logger.info(f"Index loaded ({len(_file_index)} entries) in {elapsed:.2f}s")
    return _file_index


def get_file_path(filename: str) -> Optional[str]:
    """
    Get full path for a filename from the index.
    Returns None if not found.
    """
    global _file_index, _index_loaded

    # Lazy load index if not loaded
    if not _index_loaded and os.path.exists(INDEX_FILE):
        load_index()

    return _file_index.get(filename)


def ensure_index_exists() -> bool:
    """
    Check if index exists and is recent.
    If not, build and save it.
    Returns True if index is ready.
    """
    if os.path.exists(INDEX_FILE):
        # Check if index is recent (less than 1 hour old)
        mtime = os.path.getmtime(INDEX_FILE)
        age_hours = (time.time() - mtime) / 3600
        if age_hours < 1:
            logger.info(f"Index exists and is {age_hours:.1f} hours old - using cached")
            return True
        logger.info(f"Index is {age_hours:.1f} hours old - rebuilding")

    # Build new index
    index = build_file_index()
    if index:
        save_index(index)
        return True
    return False


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Build file path index')
    parser.add_argument('--rebuild', action='store_true', help='Force rebuild index')
    parser.add_argument('--lookup', type=str, help='Look up a filename')
    parser.add_argument('--stats', action='store_true', help='Show index stats')
    args = parser.parse_args()

    if args.rebuild:
        index = build_file_index()
        save_index(index)
    elif args.lookup:
        load_index()
        path = get_file_path(args.lookup)
        if path:
            print(f"Found: {path}")
        else:
            print(f"Not found: {args.lookup}")
    elif args.stats:
        if os.path.exists(INDEX_FILE):
            load_index()
            print(f"Index entries: {len(_file_index)}")
            mtime = os.path.getmtime(INDEX_FILE)
            age = (time.time() - mtime) / 3600
            print(f"Index age: {age:.1f} hours")
        else:
            print("No index file found")
    else:
        # Default: ensure index exists
        ensure_index_exists()
