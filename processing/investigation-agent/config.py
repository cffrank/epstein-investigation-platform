"""Environment variable configuration for the investigation agent."""

import os

# PostgreSQL
PG_HOST = os.environ.get('PG_HOST', 'postgres')
PG_PORT = int(os.environ.get('PG_PORT', 5432))
PG_DATABASE = os.environ.get('PG_DATABASE', 'platform')
PG_USER = os.environ.get('PG_USER', 'investigation')
PG_PASSWORD = os.environ.get('PG_PASSWORD', '')

# Qdrant
QDRANT_HOST = os.environ.get('QDRANT_HOST', 'qdrant')
QDRANT_PORT = int(os.environ.get('QDRANT_PORT', 6333))
QDRANT_API_KEY = os.environ.get('QDRANT_API_KEY', '')
QDRANT_COLLECTION = os.environ.get('QDRANT_COLLECTION', 'document_embeddings_v2')

# Neo4j
NEO4J_HOST = os.environ.get('NEO4J_HOST', 'neo4j')
NEO4J_BOLT_PORT = int(os.environ.get('NEO4J_BOLT_PORT', 7687))
NEO4J_USER = os.environ.get('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.environ.get('NEO4J_PASSWORD', '')

# Anthropic API (Claude Sonnet / Opus)
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
CLAUDE_SONNET_MODEL = os.environ.get('CLAUDE_SONNET_MODEL', 'claude-sonnet-4-20250514')
CLAUDE_OPUS_MODEL = os.environ.get('CLAUDE_OPUS_MODEL', 'claude-opus-4-20250514')

# Workers AI (via Cloudflare Worker)
WORKERS_AI_URL = os.environ.get('WORKERS_AI_URL', 'https://epstein-api.carl-f-frank.workers.dev')
WORKERS_AI_API_KEY = os.environ.get('WORKERS_AI_API_KEY', 'test-api-key-12345')
WORKERS_AI_MODEL = os.environ.get('WORKERS_AI_MODEL', '@cf/meta/llama-4-scout-17b-16e-instruct')

# Behavior
MAX_STEPS = int(os.environ.get('MAX_STEPS', 50))
BATCH_SCAN_SIZE = int(os.environ.get('BATCH_SCAN_SIZE', 50))
REPORT_DIR = os.environ.get('REPORT_DIR', '/app/reports')
