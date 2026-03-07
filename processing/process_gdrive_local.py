#!/usr/bin/env python3
"""Process House Oversight Google Drive files locally.

Extracts ZIPs, matches images with pre-extracted text,
uploads to Hetzner S3, and imports into PostgreSQL.
"""

import hashlib
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2

# Config
DOWNLOADS = "/opt/app/data/downloads/house-oversight-gdrive"
EXTRACT_DIR = "/opt/app/data/downloads/_gdrive_extracted"
S3_PREFIX = "house-oversight/gdrive"
SOURCE_NAME = "house-oversight-gdrive"
DB_HOST = "127.0.0.1"
DB_PORT = "5432"
DB_NAME = "platform"
DB_USER = "investigation"
DB_PASS = os.environ.get("DB_PASS", "")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff"}
DOC_EXTS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}
MEDIA_EXTS = {".mp4", ".mov", ".m4v", ".3gp", ".m4a", ".opus", ".wav", ".mp3"}
ALL_EXTS = IMAGE_EXTS | DOC_EXTS | MEDIA_EXTS

# Stats
stats = {"inserted": 0, "duplicate": 0, "error": 0, "uploaded": 0}


def md5_file(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_to_s3(local_path, s3_key):
    """Upload file to Hetzner S3 via rclone."""
    result = subprocess.run(
        ["rclone", "copyto", str(local_path), f"hetzner:epstein-documents/{s3_key}", "--quiet"],
        capture_output=True, timeout=300
    )
    if result.returncode != 0:
        raise Exception(f"rclone upload failed: {result.stderr.decode()[:200]}")


def import_document(conn, filename, source, content_hash, r2_key, doc_type, file_size, text=None):
    """Import document into PostgreSQL with dedup check."""
    cur = conn.cursor()
    metadata = "{}"
    if text:
        clean_text = text.replace("\x00", "").replace("\ufeff", "").encode("ascii", errors="replace").decode("ascii")
        metadata = f'{{"text": {psycopg2.extensions.adapt(clean_text[:50000]).getquoted().decode()}}}'
        # Use parameterized approach instead
        cur.execute(
            "SELECT * FROM import_document(%s, %s, %s, %s, %s, %s, %s::jsonb)",
            (filename, source, content_hash, r2_key, doc_type, file_size,
             f'{{"text": ""}}')
        )
        result = cur.fetchone()
        doc_id, status = result[0], result[1]

        if status == "inserted" and clean_text:
            cur.execute("""
                UPDATE documents
                SET metadata = COALESCE(metadata, '{}') || jsonb_build_object('text', %s),
                    search_vector = to_tsvector('english', %s),
                    embedding_status = 'completed',
                    processed_at = NOW()
                WHERE id = %s
            """, (clean_text[:50000], clean_text[:50000], str(doc_id)))
    else:
        cur.execute(
            "SELECT * FROM import_document(%s, %s, %s, %s, %s, %s, %s::jsonb)",
            (filename, source, content_hash, r2_key, doc_type, file_size, "{}")
        )
        result = cur.fetchone()
        doc_id, status = result[0], result[1]

    conn.commit()
    return doc_id, status


def load_text_files():
    """Extract TEXT ZIP and build filename->text mapping."""
    text_map = {}
    text_zips = list(Path(DOWNLOADS).glob("TEXT-*.zip"))
    if not text_zips:
        print("No TEXT ZIP found")
        return text_map

    text_dir = Path(EXTRACT_DIR) / "TEXT"
    text_dir.mkdir(parents=True, exist_ok=True)

    for tz in text_zips:
        print(f"Extracting text ZIP: {tz.name}")
        with zipfile.ZipFile(tz) as zf:
            zf.extractall(text_dir.parent)

    # Build mapping: HOUSE_OVERSIGHT_032060 -> text content
    for txt_file in text_dir.rglob("*.txt"):
        doc_id = txt_file.stem  # e.g. HOUSE_OVERSIGHT_032060
        try:
            text_map[doc_id] = txt_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass

    print(f"Loaded {len(text_map)} text files")
    return text_map


def process_file(conn, file_path, text_map, s3_subdir):
    """Process a single file: hash, upload S3, import to PostgreSQL."""
    filename = file_path.name
    doc_id_stem = file_path.stem  # e.g. HOUSE_OVERSIGHT_032060
    ext = file_path.suffix.lower()

    if ext not in ALL_EXTS:
        return "skip"

    try:
        file_size = file_path.stat().st_size
        if file_size == 0:
            return "skip"

        content_hash = md5_file(file_path)
        r2_key = f"{S3_PREFIX}/{s3_subdir}/{filename}"

        # Determine doc type
        if ext in IMAGE_EXTS:
            doc_type = "Image"
        elif ext == ".pdf":
            doc_type = "PDF"
        elif ext in MEDIA_EXTS:
            doc_type = "Media"
        else:
            doc_type = "Document"

        # Get pre-extracted text if available
        text = text_map.get(doc_id_stem, None)

        # Import to PostgreSQL
        doc_uuid, status = import_document(
            conn, filename, SOURCE_NAME, content_hash, r2_key, doc_type, file_size, text
        )

        if status == "inserted":
            # Upload to S3
            upload_to_s3(file_path, r2_key)
            stats["inserted"] += 1
            stats["uploaded"] += 1
        else:
            stats["duplicate"] += 1

        return status

    except Exception as e:
        stats["error"] += 1
        print(f"  ERROR {filename}: {e}")
        return "error"


def process_zip(conn, zip_path, text_map, s3_subdir):
    """Extract and process one ZIP file."""
    extract_to = Path(EXTRACT_DIR) / zip_path.stem
    extract_to.mkdir(parents=True, exist_ok=True)

    print(f"\nExtracting {zip_path.name}...")
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_to)
    except zipfile.BadZipFile:
        print(f"  Bad ZIP: {zip_path.name}")
        return

    # Find all files
    files = [f for f in extract_to.rglob("*") if f.is_file() and f.suffix.lower() in ALL_EXTS]
    print(f"  Found {len(files)} files")

    for i, f in enumerate(files):
        process_file(conn, f, text_map, s3_subdir)
        if (i + 1) % 100 == 0:
            print(f"  Progress: {i+1}/{len(files)} (new={stats['inserted']}, dup={stats['duplicate']}, err={stats['error']})")

    # Clean up extracted files
    subprocess.run(["rm", "-rf", str(extract_to)], timeout=60)
    print(f"  Done. Cleaned up {extract_to}")


def main():
    os.makedirs(EXTRACT_DIR, exist_ok=True)

    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS
    )
    conn.set_client_encoding('UTF8')

    # Phase 1: Load pre-extracted text
    print("=" * 60)
    print("PHASE 1: Loading pre-extracted text files")
    print("=" * 60)
    text_map = load_text_files()

    # Phase 2: Process DATA ZIP (load files / metadata)
    print("\n" + "=" * 60)
    print("PHASE 2: Processing DATA ZIP")
    print("=" * 60)
    for zp in sorted(Path(DOWNLOADS).glob("DATA-*.zip")):
        process_zip(conn, zp, text_map, "data")

    # Phase 3: Process NATIVES ZIP
    print("\n" + "=" * 60)
    print("PHASE 3: Processing NATIVES ZIP")
    print("=" * 60)
    for zp in sorted(Path(DOWNLOADS).glob("NATIVES-*.zip")):
        process_zip(conn, zp, text_map, "natives")

    # Phase 4: Process IMAGES ZIPs one at a time
    print("\n" + "=" * 60)
    print("PHASE 4: Processing IMAGES ZIPs (41 ZIPs)")
    print("=" * 60)
    image_zips = sorted(Path(DOWNLOADS).glob("IMAGES-*.zip"))
    for idx, zp in enumerate(image_zips):
        print(f"\n[{idx+1}/{len(image_zips)}] {zp.name}")
        process_zip(conn, zp, text_map, "images")

    # Phase 5: Process Giuffre PDF
    print("\n" + "=" * 60)
    print("PHASE 5: Processing standalone files")
    print("=" * 60)
    giuffre = Path(DOWNLOADS) / "Virgina-Giuffre-Billionaire-s-Playboy-Club.pdf"
    if giuffre.exists():
        process_file(conn, giuffre, text_map, "books")

    conn.close()

    print("\n" + "=" * 60)
    print(f"COMPLETE: inserted={stats['inserted']}, duplicate={stats['duplicate']}, "
          f"error={stats['error']}, uploaded={stats['uploaded']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
