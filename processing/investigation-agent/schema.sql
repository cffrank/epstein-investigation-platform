-- Investigation Agent Schema
-- Run: docker exec postgres psql -U investigation -d platform -f /tmp/schema.sql
-- Or: cat schema.sql | docker exec -i postgres psql -U investigation -d platform

-- Investigation state table (resumable investigations)
CREATE TABLE IF NOT EXISTS investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    playbook TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning'
        CHECK (status IN ('planning', 'executing', 'awaiting_decision', 'completed', 'failed', 'cancelled')),
    target JSONB NOT NULL DEFAULT '{}',
    parameters JSONB NOT NULL DEFAULT '{}',
    state JSONB NOT NULL DEFAULT '{}',
    steps JSONB NOT NULL DEFAULT '[]',
    findings JSONB NOT NULL DEFAULT '[]',
    decision_points JSONB NOT NULL DEFAULT '[]',
    model_usage JSONB NOT NULL DEFAULT '{"workers_ai": {"calls": 0, "tokens": 0}, "sonnet": {"calls": 0, "tokens": 0}, "opus": {"calls": 0, "tokens": 0}}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations (status);
CREATE INDEX IF NOT EXISTS idx_investigations_playbook ON investigations (playbook);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations (created_at DESC);

-- Investigation findings with dedup
CREATE TABLE IF NOT EXISTS investigation_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    finding_type TEXT NOT NULL
        CHECK (finding_type IN ('connection', 'pattern', 'anomaly', 'document', 'entity', 'timeline_event', 'contradiction', 'corroboration')),
    content_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]',
    entities JSONB NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5
        CHECK (confidence >= 0 AND confidence <= 1),
    model_source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (investigation_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_findings_investigation ON investigation_findings (investigation_id);
CREATE INDEX IF NOT EXISTS idx_findings_type ON investigation_findings (finding_type);
CREATE INDEX IF NOT EXISTS idx_findings_confidence ON investigation_findings (confidence DESC);
