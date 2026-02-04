#!/usr/bin/env python3
"""
Text Extractor - Extracts text from PDFs using pdftotext
Stores extracted text in PostgreSQL metadata column and updates search_vector.

Also detects embedded images in PDFs for further processing (face detection, etc.)

Uses FOR UPDATE SKIP LOCKED for atomic document claiming across multiple workers.
"""

import os
import sys
import time
import subprocess
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional, Tuple, Dict
import psycopg2
from psycopg2.extras import RealDictCursor

# Configuration
PG_HOST = os.environ.get('PG_HOST', 'postgres')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')
DATA_DIR = os.environ.get('DATA_DIR', '/data')
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 100))
WORKER_ID = os.environ.get('WORKER_ID', '1')

# Minimum image size to consider (in pixels) - filters out icons/bullets
MIN_IMAGE_WIDTH = 100
MIN_IMAGE_HEIGHT = 100

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format=f'[Worker-{WORKER_ID}] %(asctime)s - %(levelname)s - %(message)s'
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


def find_pdf_on_disk(filename: str, source: str) -> Optional[Path]:
    """
    Try to find the PDF file on disk.
    Searches in various dataset directories based on source.
    """
    data_path = Path(DATA_DIR)

    # Map source to directory patterns
    source_dirs = {
        'dataset_9': ['datasets-2026/DataSet_9_extracted', 'DataSet_9'],
        'dataset_10': ['datasets-2026/DataSet_10_extracted', 'DataSet_10'],
        'dataset_11': ['datasets-2026/DataSet_11_extracted', 'DataSet_11'],
        'dataset_12': ['datasets-2026/DataSet_12_extracted', 'DataSet_12'],
    }

    # Get directories for this source
    dirs_to_check = source_dirs.get(source, [])

    # Also check generic locations
    dirs_to_check.extend(['', 'pdfs', 'documents'])

    for dir_pattern in dirs_to_check:
        search_path = data_path / dir_pattern / filename if dir_pattern else data_path / filename
        if search_path.exists():
            return search_path

        # Also try recursive search in the directory
        if dir_pattern:
            base_dir = data_path / dir_pattern
            if base_dir.exists():
                # Try to find the file recursively (limit depth to avoid slow searches)
                for f in base_dir.rglob(filename):
                    return f

    return None


def detect_images_in_pdf(pdf_path: Path) -> Dict:
    """
    Detect images embedded in a PDF using pdfimages -list.
    Returns dict with image metadata: count, total_pixels, has_photos, image_details.

    Uses pdfimages from poppler-utils to analyze PDF without extracting images.
    """
    try:
        result = subprocess.run(
            ['pdfimages', '-list', str(pdf_path)],
            capture_output=True,
            timeout=30
        )

        if result.returncode != 0:
            # pdfimages might fail on some PDFs, not critical
            return {'image_count': 0, 'has_photos': False, 'error': 'pdfimages_failed'}

        output = result.stdout.decode('utf-8', errors='replace')
        lines = output.strip().split('\n')

        # Skip header lines (first 2 lines are typically headers)
        data_lines = [l for l in lines[2:] if l.strip()]

        images = []
        total_pixels = 0
        significant_images = 0

        for line in data_lines:
            # pdfimages -list output format:
            # page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
            parts = line.split()
            if len(parts) >= 5:
                try:
                    page = int(parts[0])
                    img_num = int(parts[1])
                    img_type = parts[2]
                    width = int(parts[3])
                    height = int(parts[4])

                    # Filter out small images (icons, bullets, logos usually < 100px)
                    if width >= MIN_IMAGE_WIDTH and height >= MIN_IMAGE_HEIGHT:
                        significant_images += 1
                        total_pixels += width * height

                        images.append({
                            'page': page,
                            'num': img_num,
                            'type': img_type,
                            'width': width,
                            'height': height
                        })
                except (ValueError, IndexError):
                    continue

        # Determine if this likely contains photos (large images, not just diagrams)
        # Photos are typically > 200x200 and total pixel area > 100k
        has_photos = significant_images > 0 and total_pixels > 100000

        return {
            'image_count': significant_images,
            'total_pixels': total_pixels,
            'has_photos': has_photos,
            'images': images[:20]  # Limit to first 20 for metadata
        }

    except subprocess.TimeoutExpired:
        return {'image_count': 0, 'has_photos': False, 'error': 'timeout'}
    except FileNotFoundError:
        # pdfimages not installed
        return {'image_count': 0, 'has_photos': False, 'error': 'pdfimages_not_found'}
    except Exception as e:
        return {'image_count': 0, 'has_photos': False, 'error': str(e)}


def extract_text_from_pdf(pdf_path: Path) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract text from PDF using pdftotext.
    Returns (text, error_message).
    """
    try:
        result = subprocess.run(
            ['pdftotext', '-layout', str(pdf_path), '-'],
            capture_output=True,
            timeout=60  # 60 second timeout per PDF
        )

        if result.returncode != 0:
            error = result.stderr.decode('utf-8', errors='replace')
            return None, f"pdftotext error: {error}"

        text = result.stdout.decode('utf-8', errors='replace')

        # Check if we got meaningful text
        if len(text.strip()) < 50:
            # Might be a scanned/image PDF
            return None, "needs_ocr"

        return text, None

    except subprocess.TimeoutExpired:
        return None, "timeout"
    except Exception as e:
        return None, str(e)


def get_pdf_page_count(pdf_path: Path) -> Optional[int]:
    """Get page count from PDF using pdfinfo."""
    try:
        result = subprocess.run(
            ['pdfinfo', str(pdf_path)],
            capture_output=True,
            timeout=10
        )

        if result.returncode == 0:
            output = result.stdout.decode('utf-8', errors='replace')
            match = re.search(r'Pages:\s*(\d+)', output)
            if match:
                return int(match.group(1))
    except Exception:
        pass
    return None


def compute_file_hash(file_path: Path) -> str:
    """Compute MD5 hash of file."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def claim_documents(conn, limit: int) -> list:
    """
    Claim documents for processing using FOR UPDATE SKIP LOCKED.
    Returns list of document records.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Find documents that need text extraction:
        # - Have a filename (should be a PDF)
        # - Don't have extracted text in metadata yet
        # - Not marked as needs_ocr
        # - File exists on disk (we'll verify this)
        cur.execute("""
            WITH claimed AS (
                SELECT id, filename, source, r2_key, metadata
                FROM documents
                WHERE filename IS NOT NULL
                  AND filename LIKE '%%.pdf'
                  AND (metadata IS NULL OR metadata->>'text' IS NULL)
                  AND (metadata IS NULL OR metadata->>'needs_ocr' IS NULL)
                  AND (metadata IS NULL OR metadata->>'extraction_error' IS NULL)
                ORDER BY created_at ASC
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents d
            SET metadata = COALESCE(d.metadata, '{}'::jsonb) ||
                           jsonb_build_object('extraction_started', NOW()::text, 'worker_id', %s)
            FROM claimed c
            WHERE d.id = c.id
            RETURNING d.id, d.filename, d.source, d.r2_key, d.metadata
        """, (limit, WORKER_ID))

        conn.commit()
        return cur.fetchall()


def update_document_text(conn, doc_id: str, text: str, file_hash: Optional[str] = None,
                         image_info: Optional[Dict] = None, page_count: Optional[int] = None):
    """Update document with extracted text and image detection results."""
    with conn.cursor() as cur:
        # Update metadata with text and generate search_vector
        metadata_update = {
            'text': text[:500000] if len(text) > 500000 else text,  # Limit text size
            'text_length': len(text),
            'extraction_completed': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'worker_id': WORKER_ID
        }

        if file_hash:
            metadata_update['content_hash'] = file_hash

        if page_count:
            metadata_update['page_count'] = page_count

        # Add image detection results
        if image_info:
            metadata_update['image_count'] = image_info.get('image_count', 0)
            metadata_update['has_photos'] = image_info.get('has_photos', False)

            # Mark for face detection processing if has photos
            if image_info.get('has_photos'):
                metadata_update['needs_face_detection'] = True

            # Store image details (limited)
            if image_info.get('images'):
                metadata_update['image_details'] = image_info['images']

        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                search_vector = to_tsvector('english', %s),
                updated_at = NOW()
            WHERE id = %s
        """, (json.dumps(metadata_update), text[:100000], doc_id))  # Limit search vector source

        conn.commit()


def mark_document_needs_ocr(conn, doc_id: str, image_info: Optional[Dict] = None):
    """Mark document as needing OCR processing."""
    with conn.cursor() as cur:
        metadata_update = {
            'needs_ocr': True,
            'worker_id': WORKER_ID
        }

        # Even OCR docs can have photos that need face detection
        if image_info:
            metadata_update['image_count'] = image_info.get('image_count', 0)
            metadata_update['has_photos'] = image_info.get('has_photos', False)
            if image_info.get('has_photos'):
                metadata_update['needs_face_detection'] = True

        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                updated_at = NOW()
            WHERE id = %s
        """, (json.dumps(metadata_update), doc_id))
        conn.commit()


def mark_document_error(conn, doc_id: str, error: str):
    """Mark document with extraction error."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('extraction_error', %s, 'worker_id', %s),
                updated_at = NOW()
            WHERE id = %s
        """, (error, WORKER_ID, doc_id))
        conn.commit()


def mark_document_file_not_found(conn, doc_id: str):
    """Mark document as file not found on disk."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE documents
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
                           jsonb_build_object('file_not_found', true, 'worker_id', %s),
                updated_at = NOW()
            WHERE id = %s
        """, (WORKER_ID, doc_id))
        conn.commit()


def process_batch(conn) -> int:
    """
    Process a batch of documents.
    Returns number of documents processed.
    """
    documents = claim_documents(conn, BATCH_SIZE)

    if not documents:
        return 0

    logger.info(f"Processing batch of {len(documents)} documents")

    processed = 0
    for doc in documents:
        doc_id = str(doc['id'])
        filename = doc['filename']
        source = doc['source']

        # Find PDF on disk
        pdf_path = find_pdf_on_disk(filename, source)

        if not pdf_path:
            logger.warning(f"File not found: {filename} (source: {source})")
            mark_document_file_not_found(conn, doc_id)
            processed += 1
            continue

        # Detect images in PDF (for face detection marking)
        image_info = detect_images_in_pdf(pdf_path)

        # Get page count
        page_count = get_pdf_page_count(pdf_path)

        # Extract text
        text, error = extract_text_from_pdf(pdf_path)

        if error == "needs_ocr":
            logger.info(f"Needs OCR: {filename} (images: {image_info.get('image_count', 0)})")
            mark_document_needs_ocr(conn, doc_id, image_info)
        elif error:
            logger.error(f"Extraction error for {filename}: {error}")
            mark_document_error(conn, doc_id, error)
        else:
            # Compute hash and update
            try:
                file_hash = compute_file_hash(pdf_path)
            except Exception:
                file_hash = None

            update_document_text(conn, doc_id, text, file_hash, image_info, page_count)

            has_photos = image_info.get('has_photos', False)
            photo_flag = " [HAS PHOTOS]" if has_photos else ""
            logger.info(f"Extracted text from {filename} ({len(text)} chars, {image_info.get('image_count', 0)} images){photo_flag}")

        processed += 1

    return processed


def get_stats(conn) -> dict:
    """Get processing statistics."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
                COUNT(CASE WHEN metadata->>'needs_ocr' = 'true' THEN 1 END) as needs_ocr,
                COUNT(CASE WHEN metadata->>'extraction_error' IS NOT NULL THEN 1 END) as errors,
                COUNT(CASE WHEN metadata->>'file_not_found' = 'true' THEN 1 END) as not_found,
                COUNT(CASE WHEN metadata->>'has_photos' = 'true' THEN 1 END) as has_photos,
                COUNT(CASE WHEN metadata->>'needs_face_detection' = 'true' THEN 1 END) as needs_face_detection,
                COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as indexed
            FROM documents
            WHERE filename LIKE '%%.pdf'
        """)
        return cur.fetchone()


def main():
    """Main processing loop."""
    logger.info(f"Starting Text Extractor Worker {WORKER_ID}")
    logger.info(f"Data directory: {DATA_DIR}")
    logger.info(f"Batch size: {BATCH_SIZE}")

    conn = get_db_connection()

    # Print initial stats
    stats = get_stats(conn)
    logger.info(f"Initial stats: {stats}")

    total_processed = 0
    consecutive_empty = 0

    while True:
        try:
            processed = process_batch(conn)
            total_processed += processed

            if processed == 0:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    # No work available, wait longer
                    logger.info(f"No documents to process. Total processed: {total_processed}. Waiting 30s...")
                    time.sleep(30)
                else:
                    time.sleep(5)
            else:
                consecutive_empty = 0
                logger.info(f"Batch complete. Total processed: {total_processed}")

                # Brief pause between batches
                time.sleep(0.5)

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

    # Final stats
    stats = get_stats(conn)
    logger.info(f"Final stats: {stats}")
    conn.close()


if __name__ == '__main__':
    main()
