# Agent Coordinator Playbook

Reference document for the main Claude Code session on how to dispatch specialized agents for the Epstein Investigation Platform processing pipeline.

## Available Agents

| Agent | File | Purpose |
|-------|------|---------|
| `ingestion-agent` | `agents/ingestion-agent.md` | PostgreSQL import with dedup, then S3 upload |
| `text-extraction-agent` | `agents/text-extraction-agent.md` | PDF text extraction worker management |
| `ocr-agent` | `agents/ocr-agent.md` | VLM-based OCR for image PDFs via Cloudflare |
| `qdrant-transformer` | `agents/qdrant-transformer.md` | V2 OpenAI embeddings to Qdrant |
| `neo4j-transformer` | `agents/neo4j-transformer.md` | Entity extraction to Neo4j graph |
| `monitor-agent` | `agents/monitor-agent.md` | Cross-system health and progress reporting |
| `investigation-agent` | `agents/investigation-agent.md` | Investigation queries and analysis |

## Pipeline Flow

```
1. PostgreSQL  -->  2. S3 Upload  -->  3. Text Extract  -->  4. Qdrant Embed  -->  5. Neo4j Extract
   (import_document)  (rclone)          (pdf-parse)          (OpenAI 1536d)       (Cerebras LLM)
                                            |
                                            +--> [OCR if needed] --+
                                                 (Cloudflare VLM)  |
                                                                   v
                                                            back to step 4
```

1. **Ingest to PostgreSQL** - `import_document()` with MD5 dedup, creates record
2. **Upload to S3** - rclone to Hetzner object storage, only if newly inserted
3. **Text Extract** - Fetch PDF from S3, extract text via API backend, store in `metadata->>'text'`. Docs that fail get marked `needs_ocr` and go through OCR before continuing
4. **Embed in Qdrant** - Generate OpenAI embeddings (text-embedding-3-small 1536d), upsert to Qdrant V2 collection
5. **Extract to Neo4j** - Extract people, orgs, locations via Cerebras LLM, store in Neo4j graph

## Dispatch Patterns

### Get System Status
Use the monitor agent for a comprehensive check before starting any processing:

```
Task tool:
  subagent_type: general-purpose
  description: "System status report"
  prompt: |
    Read /home/carl/project/Epstein/agents/monitor-agent.md for your instructions.
    Generate a full system status report by running all the monitoring commands
    described in the agent doc. SSH to the server, check all services, and compile
    the structured report format.
```

### Start Text Extraction
```
Task tool:
  subagent_type: general-purpose
  description: "Start text extraction workers"
  prompt: |
    Read /home/carl/project/Epstein/agents/text-extraction-agent.md for your instructions.
    Start 8 text extraction workers on the server. Monitor for 2 minutes and report
    the initial throughput rate.
```

### Start OCR Processing
```
Task tool:
  subagent_type: general-purpose
  description: "Start OCR processing"
  prompt: |
    Read /home/carl/project/Epstein/agents/ocr-agent.md for your instructions.
    Start continuous OCR processing with 2 workers. Report current OCR queue size
    and estimated completion time.
```

### Start Embedding Generation
```
Task tool:
  subagent_type: qdrant-transformer
  description: "Start embedding workers"
  prompt: |
    Check current embedding progress, then start 2 embedding workers.
    Monitor for rate limiting and report initial throughput.
```

### Start Entity Extraction
```
Task tool:
  subagent_type: general-purpose
  description: "Start entity extraction"
  prompt: |
    Read /home/carl/project/Epstein/agents/neo4j-transformer.md for your instructions.
    Check current entity extraction progress, start the entity extractor,
    and report Neo4j entity counts.
```

### Ingest New Documents
```
Task tool:
  subagent_type: general-purpose
  description: "Ingest new documents"
  prompt: |
    Read /home/carl/project/Epstein/agents/ingestion-agent.md for your instructions.
    Check /opt/app/data/downloads/ for new files. Run the appropriate ingestion
    script and report results (inserted, duplicates, errors).
```

## Dispatch Order

The pipeline is **sequential** - each stage depends on the previous one completing:

### New Data Source (Full Pipeline)
1. **Ingestion Agent** - PostgreSQL import + S3 upload
2. **Text Extraction Agent** - Extract text from PDFs
3. **OCR Agent** - Process any `needs_ocr` docs (if any), feeds back into text pool
4. **Qdrant Transformer** - Generate embeddings for docs with text
5. **Neo4j Transformer** - Extract entities from docs with text

### Resume Processing (Mid-Pipeline)
Check where docs are stuck and start from that stage:
1. **Monitor Agent** - Get current status to identify the bottleneck
2. Start the appropriate agent for the earliest incomplete stage

### Parallel Opportunities
Within a single stage, multiple workers can run in parallel. Across stages, only adjacent stages can overlap when the earlier stage has a large enough lead:
- **Text Extraction** can start while **Ingestion** is still running (for already-ingested docs)
- **Embedding** can start while **Text Extraction** is still running (for already-extracted docs)
- **Entity Extraction** can start while **Embedding** is still running (both only need text)
- Always pair long-running stages with **Monitor Agent** in background

### Error Recovery
1. **Monitor Agent** - Identify what's broken
2. Appropriate pipeline agent to fix the issue
3. **Monitor Agent** - Verify the fix

## Decision Guide

| User Request | Agent | Notes |
|-------------|-------|-------|
| "Status report" | monitor-agent | Single |
| "Ingest new files" | ingestion-agent | Then continue down pipeline |
| "Start text extraction" | text-extraction-agent | Stage 3 |
| "Process OCR docs" | ocr-agent | Stage 3b (needs_ocr branch) |
| "Generate embeddings" | qdrant-transformer | Stage 4, requires text |
| "Extract entities" | neo4j-transformer | Stage 5, requires text |
| "Process everything" | Each agent in sequence | Follow pipeline order |
| "What's running?" | monitor-agent | Single |
| "Fix errors" | monitor first, then pipeline agent | Sequential |

## Background Agents

For long-running tasks, use `run_in_background: true`:

```
Task tool:
  subagent_type: general-purpose
  run_in_background: true
  description: "Background text extraction"
  prompt: |
    Read /home/carl/project/Epstein/agents/text-extraction-agent.md.
    Start 16 extraction workers and monitor for 10 minutes.
    Report final throughput and any errors.
```

Check on background agents with `TaskOutput` or by reading the output file.

## Quick Status Check (No Agent Needed)

For simple status checks, you don't need to dispatch an agent. Run directly:

```bash
# Document status summary
ssh root@88.99.61.233 'docker exec postgres psql -U investigation -d platform -c "SELECT embedding_status, COUNT(*) FROM documents GROUP BY 1 ORDER BY 2 DESC"'

# Running workers
ssh root@88.99.61.233 'pgrep -af "extract_court\|cloudflare_ocr\|embed\|entity"'

# Docker containers
ssh root@88.99.61.233 'docker ps --format "table {{.Names}}\t{{.Status}}" | sort'
```

Only dispatch agents for multi-step operations or when you need the agent to take action (start/stop workers, run scripts, compile detailed reports).
