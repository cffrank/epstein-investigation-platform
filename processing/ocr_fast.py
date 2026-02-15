#!/usr/bin/env python3
"""
Fast OCR: Tesseract first pass, VLM fallback for failures.
Processes house-oversight-gdrive images from ZIP files.

Tesseract handles ~100+ images/min for printed text.
VLM fallback for images where Tesseract extracts < 50 chars.
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
import pytesseract
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
PG = dict(host="127.0.0.1", port=5432, database="platform", user="investigation",
          password="kWn0ZqeRBGw8RVYwEp4KSdS86QqbQTOF")
WORKER_URL = os.getenv("WORKER_URL", "https://epstein-api.carl-f-frank.workers.dev")
API_KEY = os.getenv("API_SECRET_KEY", "")
ZIP_DIR = Path("/opt/app/data/downloads/house-oversight-gdrive")
TESSERACT_WORKERS = int(os.getenv("TESSERACT_WORKERS", "8"))
VLM_WORKERS = int(os.getenv("VLM_WORKERS", "4"))
MIN_TEXT_LEN = 50  # Minimum chars to consider Tesseract successful
IMAGE_MAX_DIM = 2048  # Higher res for Tesseract (it needs detail)
VLM_MAX_DIM = 1024

OCR_PROMPT = (
    "Extract ALL text from this document image exactly as it appears. "
    "Include headers, footers, page numbers, handwritten notes. "
    "For tables, preserve structure. If unclear, use [brackets]. "
    "Do not summarize - extract exactly what you see."
)


def get_pending_filenames():
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


def open_image(img_bytes, max_dim):
    img = Image.open(io.BytesIO(img_bytes))
    if img.mode in ('RGBA', 'P', 'CMYK'):
        img = img.convert('RGB')
    elif img.mode == 'L':
        pass  # Grayscale is fine for Tesseract
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    return img


def tesseract_ocr(img_bytes):
    """Run Tesseract OCR on image bytes. Returns extracted text."""
    try:
        img = open_image(img_bytes, IMAGE_MAX_DIM)
        text = pytesseract.image_to_string(img, lang='eng')
        return text.strip()
    except Exception as e:
        logger.debug("Tesseract error: %s", e)
        return ""


def vlm_ocr(img_bytes):
    """Run VLM OCR via Cloudflare Worker. Returns extracted text."""
    try:
        img = open_image(img_bytes, VLM_MAX_DIM)
        if img.mode == 'L':
            img = img.convert('RGB')
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=80)
        b64 = base64.b64encode(buf.getvalue()).decode()

        for attempt in range(3):
            try:
                resp = requests.post(
                    WORKER_URL + "/ai/ocr",
                    headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
                    json={"image": b64, "prompt": OCR_PROMPT},
                    timeout=120
                )
                if resp.status_code == 200:
                    return resp.json().get("text", "")
                if resp.status_code == 429:
                    time.sleep(2 ** attempt)
                    continue
            except Exception:
                time.sleep(1)
        return ""
    except Exception as e:
        logger.debug("VLM error: %s", e)
        return ""


def save_result(filename, text, method):
    """Save OCR text to PostgreSQL."""
    conn = psycopg2.connect(**PG)
    try:
        text = text.replace("\x00", "")
        meta = json.dumps({
            "text": text,
            "extracted_text": text,
            "text_source": method
        })
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


def process_image_tesseract(filename, img_bytes):
    """Tesseract first pass. Returns (filename, success)."""
    text = tesseract_ocr(img_bytes)
    if len(text) >= MIN_TEXT_LEN:
        save_result(filename, text, "tesseract")
        return filename, True
    return filename, False


def process_image_vlm(filename, img_bytes):
    """VLM fallback. Returns (filename, text, success)."""
    text = vlm_ocr(img_bytes)
    if text and len(text.strip()) > 5:
        save_result(filename, text, "cloudflare_vlm_fallback")
        return filename, text, True
    mark_error(filename, "no_text_extracted")
    return filename, "", False


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--tesseract-workers", type=int, default=TESSERACT_WORKERS)
    parser.add_argument("--vlm-workers", type=int, default=VLM_WORKERS)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--skip-vlm", action="store_true", help="Skip VLM fallback")
    args = parser.parse_args()

    if args.stats:
        pending = get_pending_filenames()
        print("Pending: %d" % len(pending))
        return

    pending = get_pending_filenames()
    logger.info("Found %d images needing OCR", len(pending))
    logger.info("Tesseract workers: %d, VLM workers: %d", args.tesseract_workers, args.vlm_workers)

    zip_files = sorted(ZIP_DIR.glob("IMAGES-*.zip"))
    logger.info("Found %d IMAGES ZIP files", len(zip_files))

    total = 0
    tess_ok = 0
    vlm_ok = 0
    failed = 0
    start_time = time.time()

    for zip_path in zip_files:
        logger.info("Opening ZIP: %s", zip_path.name)
        try:
            zf = zipfile.ZipFile(str(zip_path), 'r')
            jpg_entries = []
            for name in zf.namelist():
                if name.lower().endswith(('.jpg', '.jpeg', '.tif', '.tiff')):
                    if Path(name).name in pending:
                        jpg_entries.append(name)

            if not jpg_entries:
                zf.close()
                continue

            logger.info("  %d pending images", len(jpg_entries))

            # Phase 1: Tesseract (fast, parallel)
            vlm_entries = []  # ZIP entry names for VLM fallback
            CHUNK = args.tesseract_workers * 2

            for chunk_start in range(0, len(jpg_entries), CHUNK):
                if args.limit and total >= args.limit:
                    break
                chunk = jpg_entries[chunk_start:chunk_start + CHUNK]

                # Read and submit chunk
                chunk_data = []
                for entry_name in chunk:
                    if args.limit and total + len(chunk_data) >= args.limit:
                        break
                    filename = Path(entry_name).name
                    img_bytes = zf.read(entry_name)
                    chunk_data.append((entry_name, filename, img_bytes))

                with ThreadPoolExecutor(max_workers=args.tesseract_workers) as executor:
                    futures = {}
                    for entry_name, filename, img_bytes in chunk_data:
                        future = executor.submit(process_image_tesseract, filename, img_bytes)
                        futures[future] = (entry_name, filename)

                    for future in as_completed(futures):
                        entry_name, filename = futures[future]
                        try:
                            _, success = future.result()
                            total += 1
                            if success:
                                tess_ok += 1
                                pending.discard(filename)
                            else:
                                vlm_entries.append(entry_name)
                        except Exception as e:
                            logger.error("Tesseract error %s: %s", filename, e)
                            vlm_entries.append(entry_name)
                            total += 1

                # Free memory
                del chunk_data

                if total % 100 == 0 and total > 0:
                    elapsed = time.time() - start_time
                    rate = total / (elapsed / 60) if elapsed > 0 else 0
                    logger.info(
                        "Tesseract: %d done, %d ok, %d need VLM, %.0f/min",
                        total, tess_ok, len(vlm_entries), rate
                    )

            # Phase 2: VLM fallback (re-read from ZIP, slower)
            if vlm_entries and not args.skip_vlm:
                logger.info("VLM fallback: %d images", len(vlm_entries))
                VLM_CHUNK = args.vlm_workers * 2

                for chunk_start in range(0, len(vlm_entries), VLM_CHUNK):
                    chunk = vlm_entries[chunk_start:chunk_start + VLM_CHUNK]
                    with ThreadPoolExecutor(max_workers=args.vlm_workers) as executor:
                        futures = {}
                        for entry_name in chunk:
                            filename = Path(entry_name).name
                            img_bytes = zf.read(entry_name)
                            future = executor.submit(process_image_vlm, filename, img_bytes)
                            futures[future] = filename

                        for future in as_completed(futures):
                            filename = futures[future]
                            try:
                                _, text, success = future.result()
                                if success:
                                    vlm_ok += 1
                                    pending.discard(filename)
                                else:
                                    failed += 1
                            except Exception as e:
                                logger.error("VLM error %s: %s", filename, e)
                                failed += 1

                    if (chunk_start // VLM_CHUNK) % 5 == 0 and chunk_start > 0:
                        logger.info("VLM progress: %d/%d done", chunk_start, len(vlm_entries))
            elif vlm_entries and args.skip_vlm:
                logger.info("Skipping VLM for %d images (--skip-vlm)", len(vlm_entries))
                for entry_name in vlm_entries:
                    mark_error(Path(entry_name).name, "tesseract_insufficient_text")
                    failed += 1

            zf.close()

            if args.limit and total >= args.limit:
                break

        except Exception as e:
            logger.error("ZIP error %s: %s", zip_path.name, e)

    elapsed = time.time() - start_time
    rate = total / (elapsed / 60) if elapsed > 0 else 0
    logger.info(
        "COMPLETE: %d total, %d tesseract ok, %d vlm ok, %d failed, %.1f min, %.0f/min",
        total, tess_ok, vlm_ok, failed, elapsed / 60, rate
    )


if __name__ == "__main__":
    main()
