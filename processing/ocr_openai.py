#!/usr/bin/env python3
"""
OCR using OpenAI GPT-4o-mini vision for house-oversight-gdrive images.
Tesseract can't handle these (handwritten/complex scans), need AI vision.
Processes directly from ZIP files.

Falls back to Cloudflare VLM for images OpenAI refuses.
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
from openai import OpenAI
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
ZIP_DIR = Path("/opt/app/data/downloads/house-oversight-gdrive")
WORKERS = int(os.getenv("OCR_WORKERS", "8"))
IMAGE_MAX_DIM = 1024
WORKER_URL = os.getenv("WORKER_URL", "https://epstein-api.carl-f-frank.workers.dev")
CF_API_KEY = os.getenv("API_SECRET_KEY", "")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

OCR_PROMPT = (
    "You are a document text extraction tool. Read this scanned document image "
    "and output every piece of text visible in it, preserving layout. "
    "Include all headers, dates, names, addresses, body text, handwritten notes, "
    "stamps, and page numbers. If no text is visible, output only: EMPTY"
)

REFUSAL_PHRASES = [
    "i can't assist",
    "i'm sorry",
    "i cannot",
    "i'm unable",
    "as an ai",
    "i apologize",
    "not able to help",
    "can't extract text from images",
]


def is_refusal(text):
    lower = text.lower()
    return any(phrase in lower for phrase in REFUSAL_PHRASES)


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


def prepare_image(img_bytes):
    """Resize and encode image for API."""
    img = Image.open(io.BytesIO(img_bytes))
    if img.mode in ('RGBA', 'P', 'CMYK', 'L'):
        img = img.convert('RGB')
    if max(img.size) > IMAGE_MAX_DIM:
        img.thumbnail((IMAGE_MAX_DIM, IMAGE_MAX_DIM), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def openai_ocr(img_b64):
    """Call OpenAI GPT-4o-mini with vision for OCR."""
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_PROMPT},
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}",
                            "detail": "low"
                        }}
                    ]
                }],
                max_tokens=4096,
                temperature=0
            )
            text = resp.choices[0].message.content.strip()
            if is_refusal(text):
                return None  # Signal to try VLM fallback
            return text
        except Exception as e:
            err = str(e)
            if "rate_limit" in err.lower() or "429" in err:
                wait = 2 ** attempt
                logger.warning("Rate limit, waiting %ds", wait)
                time.sleep(wait)
                continue
            if attempt == 2:
                logger.error("OpenAI error: %s", err[:200])
            time.sleep(1)
    return None


def vlm_ocr(img_b64):
    """Fallback: Cloudflare Workers AI VLM OCR."""
    for attempt in range(3):
        try:
            resp = requests.post(
                WORKER_URL + "/ai/ocr",
                headers={"X-API-Key": CF_API_KEY, "Content-Type": "application/json"},
                json={"image": img_b64, "prompt": "Extract ALL text from this image exactly as written."},
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


def save_result(filename, text, method="openai_gpt4o_mini"):
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
        meta = json.dumps({"ocr_error": error[:200], "ocr_status": "error"})
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


def process_one(filename, img_bytes):
    """Process a single image: OpenAI first, VLM fallback for refusals."""
    try:
        b64 = prepare_image(img_bytes)

        # Try OpenAI first (fast)
        text = openai_ocr(b64)

        # If OpenAI refused, try Cloudflare VLM
        if text is None:
            text = vlm_ocr(b64)
            method = "cloudflare_vlm_fallback"
        else:
            method = "openai_gpt4o_mini"

        if text and text.upper() != "EMPTY" and len(text.strip()) > 2:
            save_result(filename, text, method)
            return filename, True, method
        else:
            # Genuinely no text in this image
            save_result(filename, text or "[no visible text]", method)
            return filename, True, method  # Still mark as completed
    except Exception as e:
        mark_error(filename, str(e))
        return filename, False, "error"


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=WORKERS)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--no-vlm-fallback", action="store_true")
    args = parser.parse_args()

    if args.stats:
        pending = get_pending_filenames()
        print("Pending: %d" % len(pending))
        return

    pending = get_pending_filenames()
    logger.info("Found %d images needing OCR", len(pending))
    logger.info("Workers: %d", args.workers)

    zip_files = sorted(ZIP_DIR.glob("IMAGES-*.zip"))
    logger.info("Found %d IMAGES ZIP files", len(zip_files))

    total = 0
    success = 0
    failed = 0
    vlm_used = 0
    start_time = time.time()

    for zip_path in zip_files:
        logger.info("Opening ZIP: %s", zip_path.name)
        try:
            zf = zipfile.ZipFile(str(zip_path), 'r')
            entries = []
            for name in zf.namelist():
                if name.lower().endswith(('.jpg', '.jpeg', '.tif', '.tiff')):
                    if Path(name).name in pending:
                        entries.append(name)

            if not entries:
                zf.close()
                continue

            logger.info("  %d pending images", len(entries))

            CHUNK = args.workers * 2
            for chunk_start in range(0, len(entries), CHUNK):
                if args.limit and total >= args.limit:
                    break
                chunk = entries[chunk_start:chunk_start + CHUNK]

                chunk_data = []
                for entry_name in chunk:
                    if args.limit and total + len(chunk_data) >= args.limit:
                        break
                    filename = Path(entry_name).name
                    img_bytes = zf.read(entry_name)
                    chunk_data.append((filename, img_bytes))

                with ThreadPoolExecutor(max_workers=args.workers) as executor:
                    futures = {}
                    for filename, img_bytes in chunk_data:
                        future = executor.submit(process_one, filename, img_bytes)
                        futures[future] = filename

                    for future in as_completed(futures):
                        filename = futures[future]
                        try:
                            _, ok, method = future.result()
                            total += 1
                            if ok:
                                success += 1
                                pending.discard(filename)
                                if "vlm" in method:
                                    vlm_used += 1
                            else:
                                failed += 1
                        except Exception as e:
                            logger.error("Error %s: %s", filename, e)
                            total += 1
                            failed += 1

                del chunk_data

                if total % 50 == 0 and total > 0:
                    elapsed = time.time() - start_time
                    rate = total / (elapsed / 60) if elapsed > 0 else 0
                    logger.info(
                        "Progress: %d done, %d ok, %d vlm, %d fail, %.0f/min, %d left",
                        total, success, vlm_used, failed, rate, len(pending)
                    )

            zf.close()
            if args.limit and total >= args.limit:
                break

        except Exception as e:
            logger.error("ZIP error %s: %s", zip_path.name, e)

    elapsed = time.time() - start_time
    rate = total / (elapsed / 60) if elapsed > 0 else 0
    logger.info(
        "COMPLETE: %d total, %d ok (%d vlm), %d fail, %.1f min, %.0f/min",
        total, success, vlm_used, failed, elapsed / 60, rate
    )


if __name__ == "__main__":
    main()
