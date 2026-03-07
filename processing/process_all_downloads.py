#!/usr/bin/env python3
"""Process all downloaded files: extract ZIPs, upload to S3, import into PostgreSQL.

Handles:
1. House Oversight estate PDFs and JPGs
2. House Oversight IA OCR ZIP (13 GB)
3. House Oversight estate-first ZIP (90 MB)
4. IA Court Record ZIPs (~50 cases)
5. IA EFTA Modified Dataset ZIPs
"""

import hashlib
import os
import subprocess
import sys
import zipfile
import time
from pathlib import Path

import psycopg2

# Config
DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "platform")
DB_USER = os.environ.get("DB_USER", "investigation")
DB_PASS = os.environ.get("DB_PASS", "")

DOWNLOADS = "/opt/app/data/downloads"
EXTRACT_DIR = "/opt/app/data/downloads/_extracted"

# File extensions we care about
MEDIA_EXTS = {".mp4", ".mov", ".m4v", ".3gp", ".m4a", ".opus", ".wav", ".mp3", ".amr"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff"}
DOC_EXTS = {".pdf"}
ALL_EXTS = MEDIA_EXTS | IMAGE_EXTS | DOC_EXTS


def md5_file(filepath):
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_to_s3(local_path, s3_key):
    dest = f"hetzner:epstein-documents/{s3_key}"
    result = subprocess.run(
        ["rclone", "copyto", local_path, dest, "--quiet"],
        capture_output=True, text=True, timeout=300
    )
    return result.returncode == 0


def get_doc_type(ext):
    ext = ext.lower()
    if ext in DOC_EXTS:
        return "Court Filing"
    elif ext in IMAGE_EXTS:
        return "Image"
    elif ext in {".mp4", ".mov", ".m4v", ".3gp"}:
        return "Video"
    elif ext in {".m4a", ".opus", ".wav", ".mp3", ".amr"}:
        return "Audio"
    return "Document"


def extract_zip_safe(zip_path, dest_dir):
    """Extract ZIP handling corrupted entries."""
    os.makedirs(dest_dir, exist_ok=True)
    extracted = 0
    errors = 0
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                try:
                    zf.extract(info, dest_dir)
                    extracted += 1
                except Exception:
                    errors += 1
    except zipfile.BadZipFile:
        print(f"  BAD ZIP: {zip_path}")
        return 0, 1
    return extracted, errors


def ingest_directory(conn, base_dir, source_name, s3_prefix):
    """Ingest all supported files from a directory."""
    base = Path(base_dir)
    if not base.exists():
        return 0, 0, 0

    files = []
    for root, dirs, filenames in os.walk(base):
        for f in filenames:
            ext = os.path.splitext(f)[1].lower()
            if ext in ALL_EXTS:
                files.append(os.path.join(root, f))

    if not files:
        return 0, 0, 0

    inserted = 0
    duplicates = 0
    errors = 0
    cur = conn.cursor()

    for i, fpath in enumerate(sorted(files)):
        try:
            rel_path = os.path.relpath(fpath, base)
            filename = os.path.basename(fpath)
            file_size = os.path.getsize(fpath)
            ext = os.path.splitext(fpath)[1].lower()

            if file_size == 0:
                continue

            content_hash = md5_file(fpath)
            s3_key = f"{s3_prefix}/{rel_path}"
            doc_type = get_doc_type(ext)

            cur.execute(
                "SELECT * FROM import_document(%s, %s, %s, %s, %s, %s, %s)",
                (filename, source_name, content_hash, s3_key, doc_type, file_size, "{}")
            )
            doc_id, status = cur.fetchone()

            if status == "inserted":
                if upload_to_s3(fpath, s3_key):
                    inserted += 1
                else:
                    print(f"    S3 upload failed: {filename}")
                    errors += 1
            else:
                duplicates += 1

            if (i + 1) % 100 == 0:
                conn.commit()
                print(f"    Progress: {i+1}/{len(files)} (new={inserted}, dup={duplicates}, err={errors})")

        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    Error: {fpath}: {e}")
            conn.rollback()

    conn.commit()
    return inserted, duplicates, errors


def main():
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS
    )
    conn.autocommit = False

    total_inserted = 0
    total_dup = 0
    total_err = 0
    os.makedirs(EXTRACT_DIR, exist_ok=True)

    # =========================================
    # 1. House Oversight - Estate Records (gdown PDFs)
    # =========================================
    print("\n" + "=" * 60)
    print("1. House Oversight - Estate Records (gdown)")
    for subdir in ["estate-records-1", "estate-records-2"]:
        src = f"{DOWNLOADS}/house-oversight/{subdir}"
        if os.path.exists(src):
            start = time.time()
            ins, dup, err = ingest_directory(
                conn, src, "house-oversight", f"house-oversight/{subdir}"
            )
            print(f"  {subdir}: {ins} new, {dup} dup, {err} err ({time.time()-start:.1f}s)")
            total_inserted += ins
            total_dup += dup
            total_err += err

    # =========================================
    # 2. House Oversight - Estate First (Dropbox ZIP)
    # =========================================
    print("\n" + "=" * 60)
    print("2. House Oversight - Estate First (Dropbox)")
    zip_path = f"{DOWNLOADS}/house-oversight/estate-first/estate-first.zip"
    if os.path.exists(zip_path):
        dest = f"{EXTRACT_DIR}/estate-first"
        print(f"  Extracting {zip_path}...")
        ext_count, ext_err = extract_zip_safe(zip_path, dest)
        print(f"  Extracted {ext_count} files ({ext_err} errors)")
        start = time.time()
        ins, dup, err = ingest_directory(
            conn, dest, "house-oversight", "house-oversight/estate-first"
        )
        print(f"  Ingested: {ins} new, {dup} dup, {err} err ({time.time()-start:.1f}s)")
        total_inserted += ins
        total_dup += dup
        total_err += err

    # =========================================
    # 3. House Oversight - IA OCR ZIP (13 GB)
    # =========================================
    print("\n" + "=" * 60)
    print("3. House Oversight - IA OCR (epstein-pdf.zip)")
    zip_path = f"{DOWNLOADS}/house-oversight/ia-ocr/epstein-pdf.zip"
    if os.path.exists(zip_path):
        dest = f"{EXTRACT_DIR}/ia-ocr"
        print(f"  Extracting {zip_path} (13 GB, this will take a while)...")
        ext_count, ext_err = extract_zip_safe(zip_path, dest)
        print(f"  Extracted {ext_count} files ({ext_err} errors)")
        start = time.time()
        ins, dup, err = ingest_directory(
            conn, dest, "house-oversight-ocr", "house-oversight/ia-ocr"
        )
        print(f"  Ingested: {ins} new, {dup} dup, {err} err ({time.time()-start:.1f}s)")
        total_inserted += ins
        total_dup += dup
        total_err += err

    # =========================================
    # 4. IA Court Records (~50 case ZIPs)
    # =========================================
    print("\n" + "=" * 60)
    print("4. IA Court Records")
    court_dir = f"{DOWNLOADS}/ia-full-collection/Court Records"
    if os.path.isdir(court_dir):
        zips = sorted(Path(court_dir).glob("*.zip"))
        print(f"  Found {len(zips)} court record ZIPs")
        for zp in zips:
            case_name = zp.stem
            # Create a sanitized source name
            source_name = "ia-court-" + case_name[:60].replace(" ", "-").replace(",", "").replace(".", "").lower()
            s3_prefix = f"court-records/ia-collection/{case_name}"
            dest = f"{EXTRACT_DIR}/court-records/{case_name}"

            print(f"\n  [{zips.index(zp)+1}/{len(zips)}] {case_name}")
            ext_count, ext_err = extract_zip_safe(str(zp), dest)
            print(f"    Extracted {ext_count} files ({ext_err} errors)")

            if ext_count > 0:
                start = time.time()
                ins, dup, err = ingest_directory(conn, dest, source_name, s3_prefix)
                print(f"    Ingested: {ins} new, {dup} dup, {err} err ({time.time()-start:.1f}s)")
                total_inserted += ins
                total_dup += dup
                total_err += err

    # =========================================
    # 5. IA EFTA Modified Datasets
    # =========================================
    print("\n" + "=" * 60)
    print("5. IA EFTA Modified Datasets")
    efta_dir = f"{DOWNLOADS}/ia-full-collection/Epstein Files Transparency Act (H.R.4405) Modifed Datasets"
    if os.path.isdir(efta_dir):
        zips = sorted(Path(efta_dir).rglob("*.zip"))
        print(f"  Found {len(zips)} EFTA dataset ZIPs")
        for zp in zips:
            # e.g., 20251223/DataSet 2.zip -> efta-20251223-dataset-2
            date_folder = zp.parent.name
            ds_name = zp.stem.replace(" ", "-").lower()
            source_name = f"efta-{date_folder}-{ds_name}"
            s3_prefix = f"efta-modified/{date_folder}/{zp.stem}"
            dest = f"{EXTRACT_DIR}/efta/{date_folder}/{zp.stem}"

            print(f"\n  {date_folder}/{zp.name}")
            ext_count, ext_err = extract_zip_safe(str(zp), dest)
            print(f"    Extracted {ext_count} files ({ext_err} errors)")

            if ext_count > 0:
                start = time.time()
                ins, dup, err = ingest_directory(conn, dest, source_name, s3_prefix)
                print(f"    Ingested: {ins} new, {dup} dup, {err} err ({time.time()-start:.1f}s)")
                total_inserted += ins
                total_dup += dup
                total_err += err

    # =========================================
    # Summary
    # =========================================
    print("\n" + "=" * 60)
    print(f"TOTAL: {total_inserted} inserted, {total_dup} duplicates, {total_err} errors")
    print(f"Grand total processed: {total_inserted + total_dup + total_err}")

    conn.close()


if __name__ == "__main__":
    main()
