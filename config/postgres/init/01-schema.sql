CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT DEFAULT 'viewer',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    r2_key TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    source TEXT,
    page_count INT,
    file_size_bytes BIGINT,
    content_hash TEXT,
    ocr_status TEXT DEFAULT 'pending',
    embedding_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    search_vector tsvector
);

CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    description TEXT,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    UNIQUE(entity_type, canonical_name)
);

CREATE TABLE document_entities (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    mention_count INT DEFAULT 1,
    confidence FLOAT,
    UNIQUE(document_id, entity_id)
);

CREATE TABLE face_detections (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    bbox FLOAT[] NOT NULL,
    embedding_id BIGINT,
    confidence FLOAT,
    identified_entity_id UUID REFERENCES entities(id),
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_type ON documents(doc_type);
CREATE INDEX idx_documents_source ON documents(source);
CREATE INDEX idx_documents_search ON documents USING GIN(search_vector);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_name ON entities(canonical_name);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);

INSERT INTO entities (entity_type, canonical_name, description) VALUES
    ('location', 'Little St. James Island', 'Private island in U.S. Virgin Islands'),
    ('location', 'Manhattan Townhouse', '9 East 71st Street, New York City'),
    ('location', 'Palm Beach Residence', '358 El Brillo Way, Palm Beach, Florida'),
    ('vehicle', 'N908JE', 'Boeing 727-31 "Lolita Express"')
ON CONFLICT DO NOTHING;
