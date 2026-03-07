#!/usr/bin/env python3
"""
OCR house-oversight-gdrive images directly from ZIP files.
Reads JPGs from IMAGES ZIPs, sends to Cloudflare VLM, saves text to PostgreSQL.
"""
import os
import io
import json
import time
import base64
import zipfile
import logging
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import requests
import psycopg2
from dotenv import load_dotenv

load_dotenv("/opt/app/.env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Config
PG = dict(host=os.getenv("PG_HOST", "127.0.0.1"), port=5432, database="platform", user="investigation",
          password=os.getenv("PG_PASSWORD", ""))
WORKER_URL = os.getenv("WORKER_URL", "https://epstein-api.carl-f-frank.workers.dev")
API_KEY = os.getenv("API_SECRET_KEY", "")
ZIP_DIR = Path("/opt/app/data/downloads/house-oversight-gdrive")
CONCURRENT = int(os.getenv("OCR_CONCURRENT", "4"))
IMAGE_MAX_DIM = 1024

OCR_PROMPT = (
    "Extract ALL text from this document image exactly as it appears. "
    "Include headers, footers, page numbers, handwritten notes. "
    "For tables, preserve structure. If unclear, use [brackets]. "
    "Do not summarize - extract exactly what you see."
)


def get_pending_filenames():
    """Get set of filenames that still need OCR."""
    conn = psycopg2.connect(**PG)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT filename FROM documents "
                "WHERE source = 'house-oversight-gdrive' AND embedding_status = 'needs_ocr'"
            )
            return {row[0] for row in cur.fetchall()}
    finally:
        conn.close()


def resize_image(img_bytes):
    """Resize image to max dimension and convert to JPEG."""
    img = Image.open(io.BytesIO(img_bytes))
    if img.mode in ('RGBA', 'P', 'CMYK', 'L'):
        img = img.convert('RGB')
    if max(img.size) > IMAGE_MAX_DIM:
        img.thumbnail((IMAGE_MAX_DIM, IMAGE_MAX_DIM), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=80)
    return buf.getvalue()


def call_vlm_ocr(image_b64):
    """Call Cloudflare Workers AI VLM OCR."""
    for attempt in range(3):
        try:
            resp = requests.post(
                WORKER_URL + "/ai/ocr",
                headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
                json={"image": image_b64, "prompt": OCR_PROMPT},
                timeout=120
            )
            if resp.status_code == 200:
                return resp.json().get("text", "")
            if resp.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            logger.warning("VLM error %d: %s", resp.status_code, resp.text[:100])
        except Exception as e:
            logger.warning("VLM request error: %s", e)
        time.sleep(1)
    return ""


def save_text(filename, text):
    """Save OCR text to PostgreSQL."""
    conn = psycopg2.connect(**PG)
    try:
        text = text.replace("\x00", "")
        meta = json.dumps({"text": text, "extracted_text": text, "text_source": "cloudflare_vlm_ocr"})
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb, "
                "embedding_status = 'completed', processed_at = NOW() "
                "WHERE filename = %s AND source = 'house-oversight-gdrive'",
                (meta, filename)
            )
        conn.commit()
    finally:
        conn.close()


def mark_error(filename, error):
    """Mark OCR error."""
    conn = psycopg2.connect(**PG)
    try:
        meta = json.dumps({"vlm_error": error[:200], "vlm_status": "error"})
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE documents SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb, "
                "embedding_status = 'error' "
                "WHERE filename = %s AND source = 'house-oversight-gdrive'",
                (meta, filename)
            )
        conn.commit()
    finally:
        conn.close()


def process_image(filename, img_bytes):
    """OCR a single image and save results."""
    try:
        resized = resize_image(img_bytes)
        b64 = base64.b64encode(resized).decode("utf-8")
        text = call_vlm_ocr(b64)
        if text and len(text.strip()) > 5:
            save_text(filename, text)
            return True
        else:
            mark_error(filename, "no_text_extracted")
            return False
    except Exception as e:
        mark_error(filename, str(e))
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=CONCURRENT)
    parser.add_argument("--limit", type=int, default=0, help="Max images to process (0=all)")
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    if args.stats:
        pending = get_pending_filenames()
        print("Pending OCR: %d" % len(pending))
        return

    pending = get_pending_filenames()
    logger.info("Found %d images needing OCR", len(pending))

    zip_files = sorted(ZIP_DIR.glob("IMAGES-*.zip"))
    logger.info("Found %d IMAGES ZIP files", len(zip_files))

    total_processed = 0
    total_success = 0
    start_time = time.time()

    for zip_path in zip_files:
        logger.info("Processing ZIP: %s", zip_path.name)
        try:
            zf = zipfile.ZipFile(str(zip_path), 'r')
            # Filter to only pending images
            jpg_entries = []
            for name in zf.namelist():
                lower = name.lower()
                basename = Path(name).name
                if (lower.endswith('.jpg') or lower.endswith('.jpeg') or
                    lower.endswith('.tif') or lower.endswith('.tiff')):
                    if basename in pending:
                        jpg_entries.append(name)

            if not jpg_entries:
                logger.info("  No pending images in %s", zip_path.name)
                zf.close()
                continue

            logger.info("  %d pending images in this ZIP", len(jpg_entries))

            # Process in chunks to limit memory (read + submit batch at a time)
            CHUNK = args.workers * 2
            for chunk_start in range(0, len(jpg_entries), CHUNK):
                if args.limit and total_processed >= args.limit:
                    break
                chunk = jpg_entries[chunk_start:chunk_start + CHUNK]
                with ThreadPoolExecutor(max_workers=args.workers) as executor:
                    futures = {}
                    for entry_name in chunk:
                        filename = Path(entry_name).name
                        img_bytes = zf.read(entry_name)
                        future = executor.submit(process_image, filename, img_bytes)
                        futures[future] = filename

                    for future in as_completed(futures):
                        filename = futures[future]
                        try:
                            success = future.result()
                            total_processed += 1
                            if success:
                                total_success += 1
                                pending.discard(filename)
                        except Exception as e:
                            logger.error("Error processing %s: %s", filename, e)
                            total_processed += 1

                if total_processed % 20 == 0 and total_processed > 0:
                    elapsed = time.time() - start_time
                    rate = total_processed / (elapsed / 60) if elapsed > 0 else 0
                    logger.info(
                        "Progress: %d done, %d success, %d remaining, %.0f/min",
                        total_processed, total_success, len(pending), rate
                    )

            zf.close()

            if args.limit and total_processed >= args.limit:
                break

        except Exception as e:
            logger.error("Error with ZIP %s: %s", zip_path.name, e)

    elapsed = time.time() - start_time
    rate = total_processed / (elapsed / 60) if elapsed > 0 else 0
    logger.info(
        "Complete: %d processed, %d success, %.1f min, %.0f/min avg",
        total_processed, total_success, elapsed / 60, rate
    )


if __name__ == "__main__":
    main()
