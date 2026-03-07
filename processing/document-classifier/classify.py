#!/usr/bin/env python3
"""Document classification pipeline.

Classifies documents into categories using Cloudflare Workers AI.
Processes documents in batches, using FOR UPDATE SKIP LOCKED for
safe parallel execution.
"""

import logging
import os
import sys
import time

import psycopg2
import psycopg2.extras
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

ALLOWED_CATEGORIES = {
    "email",
    "deposition_transcript",
    "court_filing",
    "financial_record",
    "flight_log",
    "calendar_entry",
    "letter_correspondence",
    "legal_motion",
    "fbi_report",
    "photograph",
    "handwritten_note",
    "other",
}

BATCH_SIZE = 25


def get_db_connection():
    """Create a PostgreSQL connection from environment variables."""
    return psycopg2.connect(
        host=os.environ["PG_HOST"],
        port=int(os.environ.get("PG_PORT", "5432")),
        dbname=os.environ["PG_DATABASE"],
        user=os.environ["PG_USER"],
        password=os.environ["PG_PASSWORD"],
    )


def claim_batch(conn):
    """Claim a batch of unclassified documents atomically.

    Returns list of (id, text_preview) tuples.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            UPDATE documents SET metadata = metadata || '{"classification_status": "processing"}'::jsonb
            WHERE id IN (
                SELECT id FROM documents
                WHERE metadata->>'text' IS NOT NULL
                AND metadata->>'content_classification' IS NULL
                AND COALESCE(metadata->>'classification_status', '') != 'processing'
                ORDER BY id
                LIMIT %s
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, SUBSTRING(metadata->>'text' FROM 1 FOR 2000) as text_preview
            """,
            (BATCH_SIZE,),
        )
        rows = cur.fetchall()
        conn.commit()
        return rows


def classify_document(text_preview, worker_url, api_key):
    """Call Workers AI to classify a document. Returns a valid category string."""
    prompt = (
        "Classify this document into exactly one category. "
        "Categories: email, deposition_transcript, court_filing, financial_record, "
        "flight_log, calendar_entry, letter_correspondence, legal_motion, "
        "fbi_report, photograph, handwritten_note, other\n\n"
        f"Document text:\n{text_preview}\n\n"
        "Category:"
    )

    try:
        resp = requests.post(
            f"{worker_url}/ai/generate",
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json",
            },
            json={"prompt": prompt, "max_tokens": 20},
            timeout=30,
        )
        resp.raise_for_status()

        data = resp.json()
        # Extract the generated text - handle various response shapes
        raw = ""
        if isinstance(data, dict):
            raw = data.get("response", data.get("result", data.get("text", "")))
            if isinstance(raw, dict):
                raw = raw.get("response", raw.get("text", ""))
        if isinstance(raw, list) and len(raw) > 0:
            raw = raw[0] if isinstance(raw[0], str) else str(raw[0])

        raw = str(raw).strip().lower().replace(" ", "_")
        # Strip leading/trailing punctuation
        raw = raw.strip(".,;:!?\"'`")

        # Validate against allowed categories
        if raw in ALLOWED_CATEGORIES:
            return raw
        # Try partial match (e.g. "court_filing." -> "court_filing")
        for cat in ALLOWED_CATEGORIES:
            if cat in raw:
                return cat
        return "other"

    except Exception as e:
        logger.warning("Classification API error: %s", e)
        return "other"


def update_document(conn, doc_id, category):
    """Update document with classification result."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE documents SET
                metadata = metadata || jsonb_build_object(
                    'content_classification', %s,
                    'file_type', %s,
                    'classification_status', 'completed'
                ),
                doc_type = %s
            WHERE id = %s
            """,
            (category, category, category, doc_id),
        )
    conn.commit()


def main():
    worker_url = os.environ.get(
        "WORKER_URL", "https://epstein-api.carl-f-frank.workers.dev"
    )
    api_key = os.environ.get("API_SECRET_KEY", "")

    if not api_key:
        logger.error("API_SECRET_KEY environment variable is required")
        sys.exit(1)

    logger.info("Starting document classification pipeline")
    logger.info("Worker URL: %s", worker_url)
    logger.info("Batch size: %d", BATCH_SIZE)

    conn = get_db_connection()
    total_classified = 0
    consecutive_empty = 0

    try:
        while True:
            batch = claim_batch(conn)

            if not batch:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    logger.info(
                        "No more unclassified documents found. Total classified: %d",
                        total_classified,
                    )
                    break
                logger.info("No documents in this batch, retrying in 5s...")
                time.sleep(5)
                continue

            consecutive_empty = 0

            for doc in batch:
                doc_id = doc["id"]
                text_preview = doc["text_preview"] or ""

                if not text_preview.strip():
                    update_document(conn, doc_id, "other")
                    total_classified += 1
                    continue

                category = classify_document(text_preview, worker_url, api_key)
                update_document(conn, doc_id, category)
                total_classified += 1

            if total_classified % 100 < BATCH_SIZE:
                logger.info("Progress: %d documents classified", total_classified)

    except KeyboardInterrupt:
        logger.info("Interrupted. Total classified: %d", total_classified)
    except Exception as e:
        logger.error("Fatal error: %s", e, exc_info=True)
        # Reset any documents stuck in 'processing' state from this run
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE documents
                    SET metadata = metadata - 'classification_status'
                    WHERE metadata->>'classification_status' = 'processing'
                    AND metadata->>'content_classification' IS NULL
                    """
                )
                conn.commit()
                logger.info("Reset stuck processing documents")
        except Exception:
            pass
        raise
    finally:
        conn.close()
        logger.info("Connection closed. Done.")


if __name__ == "__main__":
    main()
