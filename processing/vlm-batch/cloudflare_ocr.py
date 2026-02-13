#!/usr/bin/env python3
"""
Cloudflare Workers AI OCR Processor

Uses Llama 3.2 11B Vision model for OCR processing of image-based PDFs.
Cost: ~$0.049/M input tokens, ~$0.676/M output tokens (vs Anthropic at ~$0.40/$1.20)
"""
import os
import json
import base64
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
import boto3
from botocore.config import Config as BotoConfig
from pdf2image import convert_from_bytes
from PIL import Image
import io
import time
import logging
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Optional, Tuple
from dotenv import load_dotenv

# Load environment variables
load_dotenv("/opt/app/.env")

# Setup logging
LOG_DIR = Path("/opt/app/processing/vlm-batch/logs")
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "cloudflare_ocr.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Configuration - Use Worker endpoint instead of direct API
WORKER_URL = os.getenv("WORKER_URL", "https://epstein-api.carl-f-frank.workers.dev")
API_SECRET_KEY = os.getenv("API_SECRET_KEY", "test-api-key-12345")

# Hetzner S3 Configuration
HETZNER_S3_ENDPOINT = "https://fsn1.your-objectstorage.com"
HETZNER_S3_BUCKET = "epstein-documents"
HETZNER_ACCESS_KEY = os.getenv("HETZNER_ACCESS_KEY", "699EF3OFI3TCI0C819PP")
HETZNER_SECRET_KEY = os.getenv("HETZNER_SECRET_KEY", "mNTblO15Z7H2uu6w9hb422q6wXszwmrQRThBpeHU")

# PostgreSQL Configuration
POSTGRES_HOST = "127.0.0.1"
POSTGRES_PORT = 5432
POSTGRES_DB = "platform"
POSTGRES_USER = "investigation"
POSTGRES_PASSWORD = "kWn0ZqeRBGw8RVYwEp4KSdS86QqbQTOF"

# Processing settings
MAX_PAGES = 20
IMAGE_MAX_DIM = 1024
IMAGE_QUALITY = 75

# OCR Prompt
OCR_PROMPT = """Extract ALL text from this document image exactly as it appears.
Instructions:
- Extract every word, number, date, and character visible
- Preserve the original formatting as much as possible
- Include headers, footers, page numbers, and any handwritten notes
- For tables, preserve the structure using plain text formatting
- If text is partially visible or unclear, include your best interpretation in [brackets]
- Do not summarize or interpret - extract exactly what you see

Begin extraction:"""


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=HETZNER_S3_ENDPOINT,
        aws_access_key_id=HETZNER_ACCESS_KEY,
        aws_secret_access_key=HETZNER_SECRET_KEY,
        config=BotoConfig(signature_version="s3v4")
    )


def get_db_connection():
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )


def get_documents_needing_ocr(limit: int = 100) -> List[Dict]:
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, filename, hetzner_key, source, metadata
                FROM documents
                WHERE metadata->>'needs_ocr' = 'true'
                  AND hetzner_key IS NOT NULL
                  AND (metadata->>'vlm_status' IS NULL
                       OR metadata->>'vlm_status' NOT IN ('processing', 'complete'))
                ORDER BY source, filename
                LIMIT %s
            """, (limit,))
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def update_document_status(doc_id: str, status: str, extra: dict = None):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            updates = {"vlm_status": status, "vlm_processor": "cloudflare"}
            if extra:
                updates.update(extra)
            cur.execute("""
                UPDATE documents
                SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                WHERE id = %s::uuid
            """, (json.dumps(updates), doc_id))
            conn.commit()
    finally:
        conn.close()


def save_ocr_result(doc_id: str, text: str, page_count: int, processing_time: float):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            metadata_update = {
                "vlm_status": "complete",
                "vlm_processor": "cloudflare",
                "vlm_model": "llama-3.2-11b-vision",
                "vlm_page_count": page_count,
                "vlm_processing_time_seconds": round(processing_time, 2),
                "text": text,
                "extracted_text": text
            }
            cur.execute("""
                UPDATE documents
                SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                           || jsonb_build_object('vlm_processed_at', to_jsonb(NOW())),
                    processed_at = NOW()
                WHERE id = %s::uuid
            """, (json.dumps(metadata_update), doc_id))
            conn.commit()
    finally:
        conn.close()


def download_pdf(s3_client, hetzner_key: str) -> Optional[bytes]:
    try:
        response = s3_client.get_object(Bucket=HETZNER_S3_BUCKET, Key=hetzner_key)
        return response["Body"].read()
    except Exception as e:
        logger.error(f"Failed to download {hetzner_key}: {e}")
        return None


def pdf_to_images(pdf_bytes: bytes, max_pages: int = MAX_PAGES) -> List[bytes]:
    try:
        images = convert_from_bytes(
            pdf_bytes,
            dpi=150,
            first_page=1,
            last_page=max_pages
        )

        jpeg_bytes = []
        for img in images:
            if max(img.size) > IMAGE_MAX_DIM:
                ratio = IMAGE_MAX_DIM / max(img.size)
                new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                img = img.resize(new_size, Image.LANCZOS)

            buffer = io.BytesIO()
            img.convert("RGB").save(buffer, format="JPEG", quality=IMAGE_QUALITY)
            jpeg_bytes.append(buffer.getvalue())

        return jpeg_bytes
    except Exception as e:
        logger.error(f"Failed to convert PDF: {e}")
        return []


def call_cloudflare_vision(image_b64: str, retry_count: int = 3) -> Optional[str]:
    """Call Cloudflare Worker OCR endpoint."""
    ocr_url = f"{WORKER_URL}/ai/ocr"

    headers = {
        "X-API-Key": API_SECRET_KEY,
        "Content-Type": "application/json"
    }

    payload = {
        "image": image_b64,
        "prompt": OCR_PROMPT
    }

    for attempt in range(retry_count):
        try:
            response = requests.post(
                ocr_url,
                headers=headers,
                json=payload,
                timeout=120
            )

            if response.status_code == 200:
                result = response.json()
                return result.get("text", "")
            elif response.status_code == 429:
                wait_time = 2 ** attempt
                logger.warning(f"Rate limited, waiting {wait_time}s...")
                time.sleep(wait_time)
            elif response.status_code == 401:
                logger.error("Authentication failed - check API_SECRET_KEY")
                return None
            else:
                logger.error(f"API error {response.status_code}: {response.text[:200]}")

        except requests.exceptions.Timeout:
            logger.warning(f"Request timeout, attempt {attempt + 1}/{retry_count}")
        except Exception as e:
            logger.error(f"Request failed: {e}")

        if attempt < retry_count - 1:
            time.sleep(1)

    return None


def process_document(s3_client, doc: Dict) -> Tuple[str, bool, str]:
    doc_id = str(doc["id"])
    filename = doc["filename"]
    hetzner_key = doc["hetzner_key"]

    start_time = time.time()
    logger.info(f"Processing: {filename}")

    try:
        update_document_status(doc_id, "processing")

        pdf_bytes = download_pdf(s3_client, hetzner_key)
        if not pdf_bytes:
            update_document_status(doc_id, "error", {"vlm_error": "download_failed"})
            return doc_id, False, "Download failed"

        images = pdf_to_images(pdf_bytes)
        if not images:
            update_document_status(doc_id, "error", {"vlm_error": "conversion_failed"})
            return doc_id, False, "PDF conversion failed"

        logger.info(f"  {filename}: {len(images)} pages")

        page_texts = []
        for i, img_bytes in enumerate(images, 1):
            img_b64 = base64.b64encode(img_bytes).decode("utf-8")
            text = call_cloudflare_vision(img_b64)

            if text:
                page_texts.append(f"--- Page {i} ---\n{text}")
            else:
                page_texts.append(f"--- Page {i} ---\n[OCR failed for this page]")

            if i < len(images):
                time.sleep(0.5)

        full_text = "\n\n".join(page_texts)
        processing_time = time.time() - start_time

        save_ocr_result(doc_id, full_text, len(images), processing_time)

        logger.info(f"  {filename}: Complete ({len(images)} pages, {len(full_text)} chars, {processing_time:.1f}s)")
        return doc_id, True, f"{len(images)} pages"

    except Exception as e:
        update_document_status(doc_id, "error", {"vlm_error": str(e)})
        return doc_id, False, str(e)


def get_ocr_stats() -> Dict:
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE metadata->>'needs_ocr' = 'true') as total_needs_ocr,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'complete' AND metadata->>'vlm_processor' = 'cloudflare') as cf_complete,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'complete') as all_complete,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'processing') as processing,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'error') as errors,
                    COUNT(*) FILTER (WHERE metadata->>'needs_ocr' = 'true'
                        AND (metadata->>'vlm_status' IS NULL OR metadata->>'vlm_status' NOT IN ('processing', 'complete'))) as remaining
                FROM documents
            """)
            return dict(cur.fetchone())
    finally:
        conn.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Cloudflare Workers AI OCR Processor")
    parser.add_argument("--limit", type=int, default=10, help="Documents to process")
    parser.add_argument("--continuous", action="store_true", help="Run continuously")
    parser.add_argument("--stats", action="store_true", help="Show statistics only")
    parser.add_argument("--workers", type=int, default=2, help="Concurrent documents")
    parser.add_argument("--test", action="store_true", help="Test with 1 document")
    args = parser.parse_args()

    if args.stats:
        stats = get_ocr_stats()
        print("\n=== OCR Processing Stats ===")
        print(f"Total needing OCR:  {stats['total_needs_ocr']:,}")
        print(f"Cloudflare done:    {stats['cf_complete']:,}")
        print(f"All complete:       {stats['all_complete']:,}")
        print(f"Processing:         {stats['processing']:,}")
        print(f"Errors:             {stats['errors']:,}")
        print(f"Remaining:          {stats['remaining']:,}")
        return

    logger.info(f"Using Worker endpoint: {WORKER_URL}")

    s3_client = get_s3_client()

    if args.test:
        args.limit = 1
        args.workers = 1

    total_processed = 0
    total_success = 0

    while True:
        docs = get_documents_needing_ocr(limit=args.limit)

        if not docs:
            if args.continuous:
                logger.info("No documents to process, waiting 60s...")
                time.sleep(60)
                continue
            else:
                logger.info("No more documents to process")
                break

        logger.info(f"Processing batch of {len(docs)} documents...")

        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(process_document, s3_client, doc): doc
                for doc in docs
            }

            for future in as_completed(futures):
                doc_id, success, message = future.result()
                total_processed += 1
                if success:
                    total_success += 1

        stats = get_ocr_stats()
        logger.info(f"Progress: {stats['all_complete']:,}/{stats['total_needs_ocr']:,} complete ({stats['remaining']:,} remaining)")

        if not args.continuous:
            break

    print("\n" + "=" * 50)
    print("OCR Processing Complete")
    print(f"Processed: {total_processed}, Success: {total_success}")
    stats = get_ocr_stats()
    print(f"Total complete: {stats['all_complete']:,}/{stats['total_needs_ocr']:,}")


if __name__ == "__main__":
    main()
