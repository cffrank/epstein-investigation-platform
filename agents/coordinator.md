# Agent Coordinator Playbook

Reference document for the main Claude Code session on how to dispatch specialized agents for the Epstein Investigation Platform processing pipeline.

## Available Agents

| Agent | File | Purpose |
|-------|------|---------|
| `ingestion-agent` | `agents/ingestion-agent.md` | ZIP extraction, S3 upload, PostgreSQL import with dedup |
| `text-extraction-agent` | `agents/text-extraction-agent.md` | PDF text extraction worker management |
| `ocr-agent` | `agents/ocr-agent.md` | VLM-based OCR for image PDFs via Cloudflare |
| `qdrant-transformer` | `agents/qdrant-transformer.md` | V2 OpenAI embeddings to Qdrant |
| `neo4j-transformer` | `agents/neo4j-transformer.md` | Entity extraction to Neo4j graph |
| `monitor-agent` | `agents/monitor-agent.md` | Cross-system health and progress reporting |
| `investigation-agent` | `agents/investigation-agent.md` | Investigation queries and analysis |

## Pipeline Dependency Order

```
Ingest --> Text Extract --> [OCR (if needed)]
                       |
                       +--> Embed (Qdrant)
                       |
                       +--> Entity Extract (Neo4j)
```

1. **Ingest** - Documents must be in PostgreSQL + S3 before anything else
2. **Text Extract** - Depends on ingestion. Produces text for all downstream stages
3. **OCR** - Only for docs that failed text extraction (marked `needs_ocr`). Feeds back into text pool
4. **Embed** - Requires text. Can run in parallel with entity extraction
5. **Entity Extract** - Requires text. Can run in parallel with embedding

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

## Parallel Dispatch

Several agents can run simultaneously. Launch these in a single message with multiple Task tool calls:

### Full Pipeline Startup
Launch all of these in parallel:
1. **Monitor** - Get current status
2. **Text Extraction** - Start workers for pending docs
3. **OCR** - Start workers for needs_ocr docs
4. **Embedding** - Start workers for docs with text but no embedding
5. **Entity Extraction** - Start workers for docs with text but no entities

### Processing + Monitoring
Launch in parallel:
1. **Processing agent** (whichever is needed)
2. **Monitor agent** (background, periodic status)

### Post-Ingestion Pipeline
After ingestion completes, launch in parallel:
1. **Text Extraction** - Process newly ingested docs
2. **Monitor** - Track the new batch

## Sequential Dispatch

Some operations must happen in order:

### New Data Source
1. First: **Ingestion Agent** - Import new documents
2. Wait for completion
3. Then parallel: **Text Extraction** + **Monitor**
4. Wait for text extraction to finish
5. Then parallel: **Embedding** + **Entity Extraction** + **OCR** (if any needs_ocr)

### Error Recovery
1. First: **Monitor Agent** - Identify what's broken
2. Then: Appropriate agent to fix the issue
3. Then: **Monitor Agent** - Verify the fix

## Decision Guide

| User Request | Agent(s) | Parallel? |
|-------------|----------|-----------|
| "Status report" | monitor-agent | Single |
| "Start processing" | text-extraction + monitor | Parallel |
| "Ingest new files" | ingestion-agent | Single, then text-extraction |
| "Generate embeddings" | qdrant-transformer | Single |
| "Extract entities" | neo4j-transformer | Single |
| "Process everything" | All 5 pipeline agents | Parallel |
| "What's running?" | monitor-agent | Single |
| "Scale up workers" | Appropriate pipeline agent | Single |
| "Fix errors" | monitor first, then pipeline agent | Sequential |
| "How many docs need OCR?" | ocr-agent or monitor-agent | Single |

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
