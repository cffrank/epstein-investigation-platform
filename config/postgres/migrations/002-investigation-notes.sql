-- Migration: Create entity_notes table for analyst notes on entities
-- Entity IDs reference Neo4j internal IDs (not PostgreSQL entities table UUIDs)
-- because the entity detail page uses Neo4j IDs in URLs
-- Note: investigation_notes table already exists with different schema (subject-level investigation notes)

CREATE TABLE IF NOT EXISTS entity_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_notes_entity_id ON entity_notes(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_notes_created_at ON entity_notes(created_at DESC);

-- Add biography columns to entities table for AI-generated biographies
ALTER TABLE entities ADD COLUMN IF NOT EXISTS biography TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS biography_generated_at TIMESTAMPTZ;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS biography_model TEXT;
