# Investigation Agent

Autonomous investigation agent for the Epstein document corpus. Queries PostgreSQL (1.3M+ documents), Qdrant (vector embeddings), and Neo4j (88K entities, 917K relationships) using tiered AI models.

## Quick Start

```bash
ssh root@88.99.61.233
cd /opt/app

# First time: create database tables
docker exec -i postgres psql -U investigation -d platform < processing/investigation-agent/schema.sql

# Build and run interactively
docker compose -f docker-compose.processing.yml build investigation-agent
docker compose -f docker-compose.processing.yml run -it investigation-agent
```

## Model Tiers

| Tier | Model | Use Case | Cost |
|------|-------|----------|------|
| Bulk | Workers AI (Llama 4 Scout) | Summarize, classify, extract claims | Free (CF Workers) |
| Reasoning | Claude Sonnet | Pattern analysis, validation | ~$3/M input tokens |
| Deep | Claude Opus | Synthesis, credibility assessment | ~$15/M input tokens |

Automatic escalation: if Workers AI output is low quality, task escalates to Sonnet.

## Playbooks

### person_profile
Deep dive on a specific person.
```
investigate> new person_profile Ghislaine Maxwell
```
Steps: Entity lookup -> Document search -> Existing notes -> Co-mentions -> Batch summarize -> Decision -> Pattern analysis -> Connection analysis -> Extract findings -> Synthesis

### connection_map
Map connections between two entities.
```
investigate> new connection_map Jeffrey Epstein, Bill Clinton
```
Steps: Graph paths -> Co-mentions -> Entity network -> Decision -> Connection analysis -> Extract findings -> Synthesis

### document_triage
Surface and rank the most important documents on a topic.
```
investigate> new document_triage flight logs
```
Steps: Full-text search -> Semantic search -> Classify relevance -> Batch summarize -> Decision -> Pattern analysis -> Extract findings -> Synthesis

### timeline
Reconstruct chronological events.
```
investigate> new timeline Jeffrey Epstein
```
Steps: Document search -> Entity network -> Date extraction -> Decision -> Timeline analysis -> Extract findings -> Synthesis

### anomaly_detection
Find statistical outliers in the corpus.
```
investigate> new anomaly_detection full corpus
```
Steps: Source stats -> Hub analysis -> Entity network -> Anomaly analysis -> Decision -> Deep investigation -> Extract findings -> Synthesis

### free_form
Open-ended investigation from a natural language question.
```
investigate> freeform "What financial connections exist between Epstein and Deutsche Bank?"
```
Steps: Opus generates plan -> Dynamic execution -> Decision points -> Synthesis

## CLI Commands

| Command | Description |
|---------|-------------|
| `new <playbook> <target>` | Start new investigation |
| `resume <id>` | Resume paused investigation |
| `list` | List all investigations |
| `status <id>` | Show investigation status |
| `report <id>` | Generate/view report |
| `freeform "<question>"` | Free-form investigation |
| `playbooks` | List available playbooks |
| `stats` | Show platform statistics |
| `quit` | Exit |

## Decision Points

Investigations pause at decision points for human review:

```
===========================================================
  DECISION REQUIRED
===========================================================

Found 847 documents mentioning "Ghislaine Maxwell" with
142 entity connections.
Findings so far: 12

  1. Continue with deep analysis (Recommended)
  2. Focus on specific connection cluster
  3. Narrow to date range
  4. Skip to report with current findings

Your choice [1]:
```

## State Persistence

All investigation state is saved to PostgreSQL after every step:
- Investigation status, steps, findings, decision points
- Model usage tracking per tier
- Crash recovery: resume any investigation by ID

## Database Schema

```sql
-- Investigation state (resumable)
investigations: id, name, playbook, status, target, parameters, state, steps,
                findings, decision_points, model_usage, timestamps

-- Findings with dedup
investigation_findings: id, investigation_id, finding_type, content_hash,
                        title, description, evidence, entities, confidence,
                        model_source
```

## Reports

Reports are generated as Markdown with:
- Executive summary (from Opus synthesis)
- Findings grouped by confidence (HIGH/MEDIUM/LOW)
- Evidence citations with document filenames
- Entity lists
- Model usage breakdown

Saved to: `/app/reports/{investigation_id}/report_{timestamp}.md`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PG_HOST | postgres | PostgreSQL host |
| QDRANT_HOST | qdrant | Qdrant host |
| NEO4J_HOST | neo4j | Neo4j host |
| ANTHROPIC_API_KEY | (required) | Anthropic API key |
| WORKERS_AI_URL | CF Worker URL | Workers AI endpoint |
| WORKERS_AI_API_KEY | (required) | Workers AI auth |
| WORKERS_AI_MODEL | @cf/meta/llama-4-scout-17b-16e-instruct | Default Workers AI model |
| CLAUDE_SONNET_MODEL | claude-sonnet-4-20250514 | Sonnet model |
| CLAUDE_OPUS_MODEL | claude-opus-4-20250514 | Opus model |
| MAX_STEPS | 50 | Max steps per investigation |
| BATCH_SCAN_SIZE | 50 | Docs per batch scan |

## Docker Commands

```bash
# Build
docker compose -f docker-compose.processing.yml build investigation-agent

# Run interactively
docker compose -f docker-compose.processing.yml run -it investigation-agent

# View logs from detached run
docker logs investigation-agent

# Stop
docker stop investigation-agent
```

## Troubleshooting

### Workers AI returns empty responses
Check CF Worker is deployed and API key is valid:
```bash
curl -s -H "X-API-Key: $API_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","max_tokens":10}' \
  https://epstein-api.carl-f-frank.workers.dev/ai/generate
```

### Neo4j connection refused
Ensure Neo4j is running and bolt port is accessible:
```bash
docker exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "RETURN 1"
```

### Investigation stuck in "executing"
Resume will pick up from the last incomplete step:
```
investigate> resume <investigation-id>
```
