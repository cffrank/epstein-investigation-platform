# VLM Analysis Qdrant Integration

This module provides semantic search capabilities for VLM-extracted content using Qdrant vector database.

## Collection: `vlm_analysis`

### Configuration
- **Vector Dimension:** 1536 (OpenAI text-embedding-3-small)
- **Distance Metric:** Cosine
- **Storage:** On-disk (optimized for large datasets)
- **HNSW Index:** m=16, ef_construct=128, on_disk=true

### Payload Indexes
- `document_id` (keyword) - UUID link to PostgreSQL
- `source` (keyword) - Dataset name (e.g., dataset_10)
- `document_type` (keyword) - Document classification
- `embedding_type` (keyword) - full_text, people, context
- `people_count` (integer) - Number of people in document

## Embedding Strategy

Each document generates 1-3 vectors:

1. **full_text** - Complete OCR'd text for document-level search
2. **people** - Combined people descriptions for finding similar scenes
3. **context** - Locations + objects + document type for contextual similarity

## Scripts

### embed_vlm_results.py
Generates embeddings from VLM results and uploads to Qdrant.

```bash
# Process all pending documents
python qdrant/embed_vlm_results.py

# Limit to 100 documents
python qdrant/embed_vlm_results.py --limit 100

# Dry run (preview only)
python qdrant/embed_vlm_results.py --dry-run
```

### search_vlm.py
Semantic search across VLM-extracted content.

```bash
# Text search
python qdrant/search_vlm.py search "Jeffrey Epstein meeting notes"

# Search with filters
python qdrant/search_vlm.py search "private jet" --type context --source dataset_10

# Find documents similar to a specific document
python qdrant/search_vlm.py similar <doc_id> --type full_text

# Get collection stats
python qdrant/search_vlm.py stats
```

### monitor_collection.py
Monitor collection health and statistics.

```bash
# Human-readable output
python qdrant/monitor_collection.py

# Prometheus format
python qdrant/monitor_collection.py --prometheus

# Continuous monitoring
python qdrant/monitor_collection.py --watch 30
```

### metrics_exporter.py
Prometheus metrics exporter (runs as a service).

```bash
# Run as standalone
python qdrant/metrics_exporter.py --port 9091

# As systemd service
systemctl status vlm-metrics
```

## Metrics Exposed

| Metric | Type | Description |
|--------|------|-------------|
| vlm_qdrant_collection_status | gauge | 1=green, 0.5=yellow, 0=red |
| vlm_qdrant_indexed_vectors_total | gauge | Total indexed vectors |
| vlm_qdrant_points_total | gauge | Total points in collection |
| vlm_qdrant_segments_total | gauge | Number of segments |
| vlm_vectors_by_type | gauge | Vectors by embedding type |
| vlm_documents_needs_ocr | gauge | Docs needing OCR |
| vlm_documents_complete | gauge | Docs with VLM complete |
| vlm_documents_embedded | gauge | Docs with embeddings |
| vlm_documents_pending_embedding | gauge | Awaiting embedding |

## Payload Structure

```json
{
  "document_id": "uuid",
  "filename": "EFTA01234567.pdf",
  "source": "dataset_10",
  "document_type": "legal filing",
  "embedding_type": "full_text",
  "text_length": 1234,
  "text_preview": "First 500 chars...",
  "people": ["description 1", "description 2"],
  "people_count": 2,
  "locations": ["New York", "Palm Beach"],
  "objects": ["airplane", "documents"],
  "vlm_confidence": 0.95,
  "processed_at": "2026-02-06T12:00:00Z"
}
```

## API Examples

### Search via REST API
```bash
# Generate query embedding
curl -X POST https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model": "text-embedding-3-small", "input": "meeting notes"}'

# Search Qdrant
curl -X POST http://localhost:6333/collections/vlm_analysis/points/search \
  -H "api-key: $QDRANT_API_KEY" \
  -d '{
    "vector": [...],
    "limit": 10,
    "filter": {"must": [{"key": "source", "match": {"value": "dataset_10"}}]}
  }'
```

### Find Similar Documents
```python
from qdrant_client import QdrantClient

client = QdrantClient(host="localhost", port=6333, api_key="...")

# Get document vector
doc_vector = client.retrieve(
    collection_name="vlm_analysis",
    ids=["doc-uuid_text"]
)[0].vector

# Search for similar
results = client.search(
    collection_name="vlm_analysis",
    query_vector=doc_vector,
    limit=10,
    query_filter={
        "must_not": [{"key": "document_id", "match": {"value": "doc-uuid"}}]
    }
)
```

## Cost Estimation

OpenAI text-embedding-3-small: $0.02 per 1M tokens

For 43,811 documents with ~3 vectors each:
- ~130,000 vectors
- Average ~500 tokens per embedding
- **Estimated cost: $1.30**

## Integration with VLM Pipeline

After VLM batch processing completes:

1. `process_results.py` saves VLM results to PostgreSQL
2. Sets `metadata.vlm_status = 'complete'`
3. Run `embed_vlm_results.py` to generate and upload embeddings
4. Sets `metadata.vlm_embedded = true` on completion

## Monitoring Dashboard

Access Grafana at http://localhost:3001/grafana

Prometheus job: `vlm_analysis` (port 9091)
