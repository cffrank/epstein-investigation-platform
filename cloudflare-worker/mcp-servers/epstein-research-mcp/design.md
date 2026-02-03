# Epstein Investigation MCP Servers Design

## Overview

Replace direct SSH/SQL commands with structured MCP servers for safer, reusable research tools.

## Proposed MCP Servers

### 1. `epstein-documents` - Document Search & Retrieval
```
Tools:
- search_documents(query, filters) - Full-text search with PostgreSQL
- get_document(filename) - Retrieve document metadata and text
- get_document_pdf_url(filename) - Get R2 signed URL for PDF
- list_documents(dataset, limit, offset) - Browse documents
- count_documents(filters) - Get counts by dataset/type
```

### 2. `epstein-intelligence` - Investigation Notes & Analysis
```
Tools:
- get_subject_intelligence(name) - Get all intel on a person
- add_investigation_note(subject, allegation, source, summary)
- update_verification_status(note_id, status, notes)
- search_subjects(query) - Search across all investigated subjects
- get_verification_score(subject) - Get credibility assessment
- list_accused() - List all accused individuals with status
- list_cleared() - List cleared individuals
```

### 3. `epstein-sources` - Source Credibility & Verification
```
Tools:
- check_source_credibility(url_or_domain) - Get credibility tier
- add_source_rating(domain, tier, bias, notes)
- verify_claim(claim, sources[]) - Cross-reference claim against sources
- get_corroboration_count(claim) - How many sources support this
- flag_unreliable_source(url, reason)
```

### 4. `epstein-vectors` - Semantic Search (Qdrant)
```
Tools:
- semantic_search(query, limit) - Find similar documents by meaning
- find_related_documents(filename) - Documents similar to this one
- cluster_topics(query) - Group related documents by topic
- embedding_status() - Check embedding coverage
```

### 5. `epstein-entities` - People & Organizations
```
Tools:
- search_person(name) - Find all mentions of a person
- get_person_connections(name) - Who are they connected to
- get_person_documents(name) - All documents mentioning them
- search_organization(name) - Find organization mentions
- get_entity_timeline(name) - Chronological mentions
```

### 6. `epstein-network` - Relationship Mapping
```
Tools:
- get_connections(person, depth) - Network graph of connections
- find_path(person1, person2) - How are two people connected
- get_frequent_associates(person) - Most common co-mentions
- export_network_graph(filters) - Export for visualization
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server Layer                          │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│Documents │ Intel    │ Sources  │ Vectors  │ Entities       │
│ MCP      │ MCP      │ MCP      │ MCP      │ MCP            │
└──────────┴──────────┴──────────┴──────────┴────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   API / Connection Layer                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ PostgreSQL  │  │   Qdrant    │  │   Cloudflare R2     │  │
│  │ (88.99...)  │  │  (vectors)  │  │   (PDF storage)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

1. **Cleaner Interface**: `search_documents("Ehud Barak")` vs complex SQL
2. **Security**: No raw database credentials exposed
3. **Caching**: Repeated queries can be cached
4. **Validation**: Input validation before queries
5. **Rate Limiting**: Prevent accidental query floods
6. **Audit Trail**: Log all research queries
7. **Reusability**: Same tools work across sessions
8. **Type Safety**: Structured inputs/outputs

## Implementation Priority

1. **epstein-documents** - Most used, replace SSH searches
2. **epstein-intelligence** - Manage investigation notes
3. **epstein-sources** - Critical for verification
4. **epstein-entities** - Person/org searches
5. **epstein-vectors** - Semantic search
6. **epstein-network** - Relationship mapping

## Tech Stack

- **Runtime**: Node.js or Python
- **MCP SDK**: @anthropic/mcp-sdk (TypeScript) or mcp-python
- **Database**: pg (PostgreSQL client)
- **Vector DB**: qdrant-client
- **Storage**: @cloudflare/r2

## Configuration

```json
{
  "mcpServers": {
    "epstein-documents": {
      "command": "node",
      "args": ["mcp-servers/epstein-documents/index.js"],
      "env": {
        "PG_HOST": "88.99.61.233",
        "PG_DATABASE": "platform",
        "PG_USER": "investigation",
        "PG_PASSWORD": "${EPSTEIN_DB_PASSWORD}"
      }
    },
    "epstein-intelligence": {
      "command": "node",
      "args": ["mcp-servers/epstein-intelligence/index.js"]
    }
  }
}
```
