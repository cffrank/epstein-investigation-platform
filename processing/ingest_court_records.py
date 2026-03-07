#!/usr/bin/env python3
"""Ingest extracted court record PDFs into PostgreSQL and Hetzner S3."""

import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

import psycopg2

# Config
DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "platform")
DB_USER = os.environ.get("DB_USER", "investigation")
DB_PASS = os.environ.get("DB_PASS", "")

# Source mapping: local dir -> (source name, s3 prefix)
SOURCES = {
    "/opt/app/data/downloads/giuffre-v-maxwell/extracted": ("giuffre-v-maxwell", "court-records/giuffre-v-maxwell"),
    "/opt/app/data/downloads/usvi-v-jpmorgan/extracted": ("usvi-v-jpmorgan", "court-records/usvi-v-jpmorgan"),
    "/opt/app/data/downloads/us-v-epstein-2019/extracted": ("us-v-epstein-2019", "court-records/us-v-epstein-2019"),
    "/opt/app/data/downloads/us-v-maxwell/extracted": ("us-v-maxwell", "court-records/us-v-maxwell"),
    "/opt/app/data/downloads/fbi-vault": ("fbi-vault", "fbi-vault"),
}


def md5_file(filepath):
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_to_s3(local_path, s3_key):
    """Upload file to Hetzner S3 via rclone."""
    dest = f"hetzner:epstein-documents/{s3_key}"
    result = subprocess.run(
        ["rclone", "copyto", local_path, dest, "--quiet"],
        capture_output=True, text=True, timeout=120
    )
    return result.returncode == 0


def ingest_source(conn, base_dir, source_name, s3_prefix):
    """Ingest all PDFs from a directory into PostgreSQL."""
    base = Path(base_dir)
    if not base.exists():
        print(f"  Skipping {base_dir} - not found")
        return 0, 0, 0

    pdfs = sorted(base.rglob("*.pdf"))
    if not pdfs:
        print(f"  No PDFs found in {base_dir}")
        return 0, 0, 0

    inserted = 0
    duplicates = 0
    errors = 0

    print(f"  Found {len(pdfs)} PDFs in {base_dir}")

    cur = conn.cursor()
    for i, pdf_path in enumerate(pdfs):
        try:
            # Relative path for naming
            rel_path = pdf_path.relative_to(base)
            filename = str(rel_path)
            file_size = pdf_path.stat().st_size

            if file_size == 0:
                continue

            # Compute hash
            content_hash = md5_file(str(pdf_path))

            # S3 key
            s3_key = f"{s3_prefix}/{filename}"

            # Import to PostgreSQL
            cur.execute(
                "SELECT * FROM import_document(%s, %s, %s, %s, %s, %s, %s)",
                (filename, source_name, content_hash, s3_key, "Court Filing", file_size, "{}")
            )
            doc_id, status = cur.fetchone()

            if status == "inserted":
                # Upload to S3
                if upload_to_s3(str(pdf_path), s3_key):
                    inserted += 1
                else:
                    print(f"    S3 upload failed: {filename}")
                    errors += 1
            else:
                duplicates += 1

            if (i + 1) % 100 == 0:
                conn.commit()
                print(f"    Progress: {i+1}/{len(pdfs)} (inserted={inserted}, dup={duplicates}, err={errors})")

        except Exception as e:
            errors += 1
            if (i + 1) % 100 == 0:
                print(f"    Error on {pdf_path}: {e}")
            conn.rollback()

    conn.commit()
    return inserted, duplicates, errors


def main():
    # Allow filtering to specific source
    filter_source = sys.argv[1] if len(sys.argv) > 1 else None

    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS
    )
    conn.autocommit = False

    total_inserted = 0
    total_dup = 0
    total_err = 0

    for base_dir, (source_name, s3_prefix) in SOURCES.items():
        if filter_source and filter_source != source_name:
            continue

        print(f"\n{'='*60}")
        print(f"Ingesting: {source_name}")
        print(f"  Dir: {base_dir}")
        print(f"  S3:  {s3_prefix}")

        start = time.time()
        inserted, dups, errs = ingest_source(conn, base_dir, source_name, s3_prefix)
        elapsed = time.time() - start

        print(f"  Done in {elapsed:.1f}s: {inserted} inserted, {dups} duplicates, {errs} errors")
        total_inserted += inserted
        total_dup += dups
        total_err += errs

    print(f"\n{'='*60}")
    print(f"TOTAL: {total_inserted} inserted, {total_dup} duplicates, {total_err} errors")

    conn.close()


if __name__ == "__main__":
    main()
