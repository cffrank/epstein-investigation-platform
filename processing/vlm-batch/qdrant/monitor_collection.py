#!/usr/bin/env python3
"""
VLM Analysis Collection Monitor

Monitors the health and statistics of the vlm_analysis Qdrant collection.
Outputs metrics in Prometheus format for scraping.
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime
from pathlib import Path
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

# PostgreSQL
POSTGRES_HOST = os.getenv('POSTGRES_HOST', '127.0.0.1')
POSTGRES_PORT = int(os.getenv('POSTGRES_PORT', 5432))
POSTGRES_DB = os.getenv('POSTGRES_DB', 'platform')
POSTGRES_USER = os.getenv('POSTGRES_USER', 'investigation')
POSTGRES_PASSWORD = os.getenv('POSTGRES_PASSWORD', '')

# Prometheus metrics output
METRICS_FILE = Path('/opt/app/processing/vlm-batch/logs/qdrant_metrics.prom')


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )


def get_qdrant_collection_info() -> Optional[Dict]:
    """Get collection information from Qdrant."""
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    try:
        response = requests.get(
            f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}',
            headers=headers,
            timeout=10
        )

        if response.status_code == 200:
            return response.json().get('result', {})
        else:
            return None

    except Exception as e:
        print(f"Error getting collection info: {e}", file=sys.stderr)
        return None


def get_qdrant_telemetry() -> Optional[Dict]:
    """Get Qdrant server telemetry."""
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    try:
        response = requests.get(
            f'http://{QDRANT_HOST}:{QDRANT_PORT}/telemetry',
            headers=headers,
            timeout=10
        )

        if response.status_code == 200:
            return response.json().get('result', {})
        else:
            return None

    except Exception as e:
        print(f"Error getting telemetry: {e}", file=sys.stderr)
        return None


def get_embedding_stats_from_db() -> Dict:
    """Get embedding statistics from PostgreSQL."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'complete') as vlm_complete,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_embedded' = 'true') as vlm_embedded,
                    COUNT(*) FILTER (WHERE metadata->>'vlm_status' = 'complete'
                                     AND (metadata->>'vlm_embedded' IS NULL
                                          OR metadata->>'vlm_embedded' = 'false')) as pending_embedding,
                    COALESCE(SUM((metadata->>'vlm_vector_count')::int)
                             FILTER (WHERE metadata->>'vlm_embedded' = 'true'), 0) as total_vectors_db
                FROM documents
            """)
            return dict(cur.fetchone())
    except Exception as e:
        print(f"Error getting DB stats: {e}", file=sys.stderr)
        return {}
    finally:
        conn.close()


def get_embedding_type_distribution() -> Dict:
    """Get distribution of embedding types in Qdrant."""
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    distribution = {}

    for emb_type in ['full_text', 'people', 'context']:
        try:
            payload = {
                'filter': {
                    'must': [{
                        'key': 'embedding_type',
                        'match': {'value': emb_type}
                    }]
                },
                'limit': 0  # Just count
            }

            response = requests.post(
                f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/count',
                headers=headers,
                json=payload,
                timeout=10
            )

            if response.status_code == 200:
                distribution[emb_type] = response.json().get('result', {}).get('count', 0)
            else:
                distribution[emb_type] = 0

        except Exception:
            distribution[emb_type] = 0

    return distribution


def get_source_distribution() -> Dict:
    """Get distribution of sources in Qdrant."""
    headers = {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }

    # First get a sample to find sources
    try:
        payload = {
            'limit': 1000,
            'with_payload': {'include': ['source']},
            'with_vector': False
        }

        response = requests.post(
            f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/scroll',
            headers=headers,
            json=payload,
            timeout=30
        )

        if response.status_code == 200:
            points = response.json().get('result', {}).get('points', [])
            sources = set()
            for p in points:
                source = p.get('payload', {}).get('source')
                if source:
                    sources.add(source)

            # Count each source
            distribution = {}
            for source in sources:
                count_payload = {
                    'filter': {
                        'must': [{
                            'key': 'source',
                            'match': {'value': source}
                        }]
                    }
                }

                count_response = requests.post(
                    f'http://{QDRANT_HOST}:{QDRANT_PORT}/collections/{QDRANT_COLLECTION}/points/count',
                    headers=headers,
                    json=count_payload,
                    timeout=10
                )

                if count_response.status_code == 200:
                    distribution[source] = count_response.json().get('result', {}).get('count', 0)

            return distribution

    except Exception as e:
        print(f"Error getting source distribution: {e}", file=sys.stderr)

    return {}


def format_prometheus_metrics(collection_info: Dict, db_stats: Dict,
                              type_dist: Dict, source_dist: Dict,
                              telemetry: Dict) -> str:
    """Format metrics in Prometheus exposition format."""
    lines = []
    timestamp = int(time.time() * 1000)

    # Collection metrics
    lines.append("# HELP vlm_qdrant_vectors_total Total vectors in vlm_analysis collection")
    lines.append("# TYPE vlm_qdrant_vectors_total gauge")
    vectors = collection_info.get('indexed_vectors_count', 0)
    lines.append(f"vlm_qdrant_vectors_total {vectors}")

    lines.append("# HELP vlm_qdrant_points_total Total points in vlm_analysis collection")
    lines.append("# TYPE vlm_qdrant_points_total gauge")
    points = collection_info.get('points_count', 0)
    lines.append(f"vlm_qdrant_points_total {points}")

    lines.append("# HELP vlm_qdrant_segments_total Number of segments")
    lines.append("# TYPE vlm_qdrant_segments_total gauge")
    segments = collection_info.get('segments_count', 0)
    lines.append(f"vlm_qdrant_segments_total {segments}")

    # Status
    status = collection_info.get('status', 'unknown')
    status_value = 1 if status == 'green' else (0.5 if status == 'yellow' else 0)
    lines.append("# HELP vlm_qdrant_collection_status Collection status (1=green, 0.5=yellow, 0=red)")
    lines.append("# TYPE vlm_qdrant_collection_status gauge")
    lines.append(f"vlm_qdrant_collection_status {status_value}")

    # DB stats
    lines.append("# HELP vlm_documents_complete Documents with VLM processing complete")
    lines.append("# TYPE vlm_documents_complete gauge")
    lines.append(f"vlm_documents_complete {db_stats.get('vlm_complete', 0)}")

    lines.append("# HELP vlm_documents_embedded Documents with embeddings uploaded")
    lines.append("# TYPE vlm_documents_embedded gauge")
    lines.append(f"vlm_documents_embedded {db_stats.get('vlm_embedded', 0)}")

    lines.append("# HELP vlm_documents_pending_embedding Documents awaiting embedding")
    lines.append("# TYPE vlm_documents_pending_embedding gauge")
    lines.append(f"vlm_documents_pending_embedding {db_stats.get('pending_embedding', 0)}")

    # Embedding type distribution
    lines.append("# HELP vlm_vectors_by_type Vectors by embedding type")
    lines.append("# TYPE vlm_vectors_by_type gauge")
    for emb_type, count in type_dist.items():
        lines.append(f'vlm_vectors_by_type{{type="{emb_type}"}} {count}')

    # Source distribution
    lines.append("# HELP vlm_vectors_by_source Vectors by source dataset")
    lines.append("# TYPE vlm_vectors_by_source gauge")
    for source, count in source_dist.items():
        lines.append(f'vlm_vectors_by_source{{source="{source}"}} {count}')

    # Telemetry if available
    if telemetry:
        app = telemetry.get('app', {})
        if 'grpc' in app:
            grpc = app['grpc']
            lines.append("# HELP vlm_qdrant_grpc_responses_total GRPC responses")
            lines.append("# TYPE vlm_qdrant_grpc_responses_total counter")
            lines.append(f"vlm_qdrant_grpc_responses_total {grpc.get('responses', {}).get('total', 0)}")

    return '\n'.join(lines)


def print_human_readable(collection_info: Dict, db_stats: Dict,
                         type_dist: Dict, source_dist: Dict):
    """Print metrics in human-readable format."""
    print("\n" + "=" * 60)
    print("VLM Analysis Collection Monitor")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 60)

    print("\n### Collection Status ###")
    print(f"  Status: {collection_info.get('status', 'unknown')}")
    print(f"  Optimizer: {collection_info.get('optimizer_status', 'unknown')}")
    print(f"  Indexed vectors: {collection_info.get('indexed_vectors_count', 0):,}")
    print(f"  Total points: {collection_info.get('points_count', 0):,}")
    print(f"  Segments: {collection_info.get('segments_count', 0)}")

    print("\n### Database Stats ###")
    print(f"  VLM complete: {db_stats.get('vlm_complete', 0):,}")
    print(f"  VLM embedded: {db_stats.get('vlm_embedded', 0):,}")
    print(f"  Pending embedding: {db_stats.get('pending_embedding', 0):,}")

    print("\n### Embedding Type Distribution ###")
    for emb_type, count in type_dist.items():
        print(f"  {emb_type}: {count:,}")

    if source_dist:
        print("\n### Source Distribution ###")
        for source, count in sorted(source_dist.items(), key=lambda x: -x[1])[:10]:
            print(f"  {source}: {count:,}")


def main():
    """Main monitoring function."""
    parser = argparse.ArgumentParser(description='Monitor VLM Analysis Qdrant collection')
    parser.add_argument('--prometheus', action='store_true',
                        help='Output in Prometheus format')
    parser.add_argument('--output', type=str,
                        help='Write metrics to file')
    parser.add_argument('--watch', type=int,
                        help='Continuously watch with interval (seconds)')
    parser.add_argument('--no-source-dist', action='store_true',
                        help='Skip source distribution (faster)')
    args = parser.parse_args()

    while True:
        # Gather metrics
        collection_info = get_qdrant_collection_info() or {}
        db_stats = get_embedding_stats_from_db()
        type_dist = get_embedding_type_distribution()
        source_dist = {} if args.no_source_dist else get_source_distribution()
        telemetry = get_qdrant_telemetry() or {}

        if args.prometheus:
            output = format_prometheus_metrics(
                collection_info, db_stats, type_dist, source_dist, telemetry
            )
            if args.output:
                with open(args.output, 'w') as f:
                    f.write(output + '\n')
            else:
                print(output)
        else:
            print_human_readable(collection_info, db_stats, type_dist, source_dist)

        if not args.watch:
            break

        time.sleep(args.watch)


if __name__ == '__main__':
    main()
