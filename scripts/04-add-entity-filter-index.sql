-- Phase 4: Entity filter and autocomplete indexes
-- Run on production: ssh root@88.99.61.233 'docker exec postgres psql -U investigation -d platform -f -' < scripts/04-add-entity-filter-index.sql

-- Ensure pg_trgm extension for trigram-based prefix search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index for entity_id lookups (filter direction: "find all documents mentioning entity X")
-- The existing UNIQUE(document_id, entity_id) handles the reverse direction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_entities_entity_id
ON document_entities(entity_id);

-- Trigram index for entity name autocomplete (ILIKE prefix search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entities_name_trgm
ON entities USING GIN(canonical_name gin_trgm_ops);
