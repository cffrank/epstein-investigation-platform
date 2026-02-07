#!/usr/bin/env python3
"""
VLM Analysis Metrics Exporter

Runs as a simple HTTP server exposing Prometheus metrics for the VLM analysis pipeline.
Metrics include:
- Qdrant collection status (vectors, points, segments)
- PostgreSQL pipeline status (pending, complete, embedded)
- Embedding type distribution

Run with: python metrics_exporter.py --port 9091
"""

import os
import sys
import json
import time
import argparse
import http.server
import socketserver
import threading
from typing import Dict, Optional

import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment
load_dotenv('/opt/app/.env')

# Configuration
QDRANT_HOST = os.getenv('QDRANT_HOST', '127.0.0.1')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', 6333))
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY', '')
QDRANT_COLLECTION = 'vlm_analysis'

POSTGRES_HOST = os.getenv('POSTGRES_HOST', '127.0.0.1')
POSTGRES_PORT = int(os.getenv('POSTGRES_PORT', 5432))
POSTGRES_DB = os.getenv('POSTGRES_DB', 'platform')
POSTGRES_USER = os.getenv('POSTGRES_USER', 'investigation')
POSTGRES_PASSWORD = os.getenv('POSTGRES_PASSWORD', '')

# Metric cache (refresh every 30 seconds)
CACHE_TTL = 30
metrics_cache = {
    'data': '',
    'timestamp': 0
}


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )


def get_qdrant_metrics() -> Dict:
    """Get metrics from Qdrant."""
    headers = {'api-key': QDRANT_API_KEY}

    try:
        # Collection info
        response = requests.get(
            f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}',
            headers=headers,
            timeout=5
        )

        if response.status_code == 200:
            result = response.json().get('result', {})
            return {
                'status': result.get('status', 'unknown'),
                'indexed_vectors': result.get('indexed_vectors_count', 0),
                'points': result.get('points_count', 0),
                'segments': result.get('segments_count', 0),
                'optimizer_status': result.get('optimizer_status', 'unknown')
            }
    except Exception:
        pass

    return {}


def get_embedding_type_counts() -> Dict:
    """Get counts for each embedding type."""
    headers = {'api-key': QDRANT_API_KEY}
    counts = {}

    for emb_type in ['full_text', 'people', 'context']:
        try:
            payload = {
                'filter': {
                    'must': [{'key': 'embedding_type', 'match': {'value': emb_type}}]
                }
            }
            response = requests.post(
                f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/count',
                headers=headers,
                json=payload,
                timeout=5
            )
            if response.status_code == 200:
                counts[emb_type] = response.json().get('result', {}).get('count', 0)
        except Exception:
            counts[emb_type] = 0

    return counts


def get_pipeline_stats() -> Dict:
    """Get VLM pipeline statistics from PostgreSQL."""
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE metadata->>'needs_ocr' = 'true') as needs_ocr,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'complete') as vlm_complete,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'processing') as vlm_processing,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'error') as vlm_error,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_embedded' = 'true') as vlm_embedded,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'complete'
                                     AND (metadata->>'vlm_embedded' IS NULL
                                          OR metadata->>'vlm_embedded' = 'false')) as pending_embedding
                FROM documents
            """)
            return dict(cur.fetchone())
    except Exception:
        return {}
    finally:
        if 'conn' in locals():
            conn.close()


def generate_metrics() -> str:
    """Generate Prometheus-format metrics."""
    lines = []

    # Get data
    qdrant = get_qdrant_metrics()
    types = get_embedding_type_counts()
    pipeline = get_pipeline_stats()

    # Qdrant collection metrics
    lines.append("# HELP vlm_qdrant_collection_status Collection status (1=green, 0.5=yellow, 0=red/unknown)")
    lines.append("# TYPE vlm_qdrant_collection_status gauge")
    status = qdrant.get('status', 'unknown')
    status_val = 1 if status == 'green' else (0.5 if status == 'yellow' else 0)
    lines.append(f"vlm_qdrant_collection_status {status_val}")

    lines.append("# HELP vlm_qdrant_indexed_vectors_total Total indexed vectors")
    lines.append("# TYPE vlm_qdrant_indexed_vectors_total gauge")
    lines.append(f"vlm_qdrant_indexed_vectors_total {qdrant.get('indexed_vectors', 0)}")

    lines.append("# HELP vlm_qdrant_points_total Total points in collection")
    lines.append("# TYPE vlm_qdrant_points_total gauge")
    lines.append(f"vlm_qdrant_points_total {qdrant.get('points', 0)}")

    lines.append("# HELP vlm_qdrant_segments_total Number of segments")
    lines.append("# TYPE vlm_qdrant_segments_total gauge")
    lines.append(f"vlm_qdrant_segments_total {qdrant.get('segments', 0)}")

    # Embedding type distribution
    lines.append("# HELP vlm_vectors_by_type Vectors grouped by embedding type")
    lines.append("# TYPE vlm_vectors_by_type gauge")
    for emb_type, count in types.items():
        lines.append(f'vlm_vectors_by_type{{type="{emb_type}"}} {count}')

    # Pipeline stats
    lines.append("# HELP vlm_documents_needs_ocr Documents that need OCR processing")
    lines.append("# TYPE vlm_documents_needs_ocr gauge")
    lines.append(f"vlm_documents_needs_ocr {pipeline.get('needs_ocr', 0)}")

    lines.append("# HELP vlm_documents_complete Documents with VLM processing complete")
    lines.append("# TYPE vlm_documents_complete gauge")
    lines.append(f"vlm_documents_complete {pipeline.get('vlm_complete', 0)}")

    lines.append("# HELP vlm_documents_processing Documents currently being processed")
    lines.append("# TYPE vlm_documents_processing gauge")
    lines.append(f"vlm_documents_processing {pipeline.get('vlm_processing', 0)}")

    lines.append("# HELP vlm_documents_error Documents with VLM errors")
    lines.append("# TYPE vlm_documents_error gauge")
    lines.append(f"vlm_documents_error {pipeline.get('vlm_error', 0)}")

    lines.append("# HELP vlm_documents_embedded Documents with embeddings in Qdrant")
    lines.append("# TYPE vlm_documents_embedded gauge")
    lines.append(f"vlm_documents_embedded {pipeline.get('vlm_embedded', 0)}")

    lines.append("# HELP vlm_documents_pending_embedding Documents awaiting embedding generation")
    lines.append("# TYPE vlm_documents_pending_embedding gauge")
    lines.append(f"vlm_documents_pending_embedding {pipeline.get('pending_embedding', 0)}")

    return '\n'.join(lines) + '\n'


def get_metrics_cached() -> str:
    """Get metrics with caching."""
    now = time.time()
    if now - metrics_cache['timestamp'] > CACHE_TTL:
        metrics_cache['data'] = generate_metrics()
        metrics_cache['timestamp'] = now
    return metrics_cache['data']


class MetricsHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler for metrics endpoint."""

    def do_GET(self):
        if self.path == '/metrics':
            metrics = get_metrics_cached()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(metrics.encode('utf-8'))
        elif self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress access logs
        pass


def main():
    """Run the metrics exporter server."""
    parser = argparse.ArgumentParser(description='VLM Analysis Prometheus Metrics Exporter')
    parser.add_argument('--port', type=int, default=9091, help='Port to listen on')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Host to bind to')
    args = parser.parse_args()

    with socketserver.TCPServer((args.host, args.port), MetricsHandler) as httpd:
        print(f"VLM Metrics Exporter running on http://{args.host}:{args.port}")
        print(f"  Metrics: http://{args.host}:{args.port}/metrics")
        print(f"  Health:  http://{args.host}:{args.port}/health")
        httpd.serve_forever()


if __name__ == '__main__':
    main()
