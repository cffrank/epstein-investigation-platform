#!/usr/bin/env python3
"""Text extraction worker for court records stored in Hetzner S3.

Fetches PDFs from Hetzner S3, extracts text via the API backend,
and updates PostgreSQL. Runs in parallel-safe mode using FOR UPDATE SKIP LOCKED.
"""

import base64
import json
import os
import subprocess
import sys
import time

import psycopg2
import requests

# Config
DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "platform")
DB_USER = os.environ.get("DB_USER", "investigation")
DB_PASS = os.environ.get("DB_PASS", "kWn0ZqeRBGw8RVYwEp4KSdS86QqbQTOF")
API_URL = os.environ.get("API_URL", "http://localhost:8080")
API_KEY = os.environ.get("API_KEY", "")
WORKER_ID = os.environ.get("WORKER_ID", "1")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "10"))
MAX_FILE_SIZE = int(os.environ.get("MAX_FILE_SIZE", "20000000"))  # 20MB

SOURCES = None  # None = all sources (no filter)


def fetch_from_s3(r2_key):
    """Fetch file from Hetzner S3 via rclone and return bytes."""
    s3_path = f"hetzner:epstein-documents/{r2_key}"
    result = subprocess.run(
        ["rclone", "cat", s3_path],
        capture_output=True, timeout=120
    )
    if result.returncode != 0:
        raise Exception(f"rclone cat failed: {result.stderr.decode()[:200]}")
    return result.stdout


def claim_documents(conn, batch_size):
    """Claim a batch of unprocessed documents atomically."""
    cur = conn.cursor()
    source_filter = ""
    if SOURCES:
        sources_str = ",".join(f"'{s}'" for s in SOURCES)
        source_filter = f"AND source IN ({sources_str})"
    cur.execute(f"""
        WITH claimed AS (
            SELECT id
            FROM documents
            WHERE embedding_status = 'pending'
              AND r2_key IS NOT NULL
              AND file_size_bytes > 0
              AND file_size_bytes < {MAX_FILE_SIZE}
              {source_filter}
            ORDER BY file_size_bytes ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
        )
        UPDATE documents d
        SET embedding_status = 'processing'
        FROM claimed c
        WHERE d.id = c.id
        RETURNING d.id, d.r2_key, d.source, d.filename, d.file_size_bytes
    """, (batch_size,))
    rows = cur.fetchall()
    conn.commit()
    return rows


def process_document(conn, doc_id, r2_key, filename, api_key):
    """Fetch PDF from S3, extract text via API, update database."""
    try:
        # Fetch from Hetzner S3
        pdf_bytes = fetch_from_s3(r2_key)
        pdf_b64 = base64.b64encode(pdf_bytes).decode()

        # Call extract API
        resp = requests.post(
            f"{API_URL}/api/extract",
            json={
                "documentId": str(doc_id),
                "pdfContent": pdf_b64,
            },
            headers={"X-API-Key": api_key},
            timeout=120,
        )

        if resp.status_code != 200:
            raise Exception(f"API error {resp.status_code}: {resp.text[:200]}")

        result = resp.json()
        needs_ocr = result.get("needsOcr", False)
        text = result.get("text", "").replace("\x00", "")
        pages = result.get("pageCount", 0)

        # Update text and search vector if we got text
        cur = conn.cursor()
        if not needs_ocr and len(text) > 50:
            cur.execute("""
                UPDATE documents
                SET metadata = COALESCE(metadata, '{}') || jsonb_build_object('text', %s),
                    search_vector = to_tsvector('english', %s),
                    embedding_status = 'completed',
                    processed_at = NOW()
                WHERE id = %s
            """, (text[:50000], text[:50000], str(doc_id)))
        elif needs_ocr:
            cur.execute("""
                UPDATE documents
                SET embedding_status = 'needs_ocr',
                    processed_at = NOW()
                WHERE id = %s
            """, (str(doc_id),))
        else:
            # Very little text
            cur.execute("""
                UPDATE documents
                SET embedding_status = 'completed',
                    processed_at = NOW()
                WHERE id = %s
            """, (str(doc_id),))

        conn.commit()
        return "ocr" if needs_ocr else "ok"

    except Exception as e:
        # Mark as error (don't reset to pending - causes infinite retry loops)
        try:
            cur = conn.cursor()
            cur.execute("""
                UPDATE documents
                SET embedding_status = 'error',
                    metadata = COALESCE(metadata, '{}') || jsonb_build_object('extract_error', %s)
                WHERE id = %s
            """, (str(e)[:500], str(doc_id)))
            conn.commit()
        except Exception:
            conn.rollback()
        return f"error: {str(e)[:100]}"


def main():
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS
    )

    # Read API key from env file
    api_key = API_KEY
    if not api_key:
        try:
            with open("/opt/app/.env") as f:
                for line in f:
                    if line.startswith("API_SECRET_KEY="):
                        api_key = line.strip().split("=", 1)[1]
                        break
        except Exception:
            pass

    if not api_key:
        print("ERROR: No API key found")
        sys.exit(1)

    total_ok = 0
    total_ocr = 0
    total_err = 0
    batch_num = 0

    print(f"Worker {WORKER_ID} starting, batch size {BATCH_SIZE}")

    while True:
        docs = claim_documents(conn, BATCH_SIZE)
        if not docs:
            print(f"Worker {WORKER_ID}: No more documents. Totals: ok={total_ok}, ocr={total_ocr}, err={total_err}")
            break

        batch_num += 1
        for doc_id, r2_key, source, filename, file_size in docs:
            result = process_document(conn, doc_id, r2_key, filename, api_key)
            if result == "ok":
                total_ok += 1
            elif result == "ocr":
                total_ocr += 1
            else:
                total_err += 1

        processed = total_ok + total_ocr + total_err
        print(f"Worker {WORKER_ID} batch {batch_num}: processed={processed} (ok={total_ok}, ocr={total_ocr}, err={total_err})")

    conn.close()


if __name__ == "__main__":
    main()
