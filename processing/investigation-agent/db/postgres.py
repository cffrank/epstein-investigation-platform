"""PostgreSQL database client for the investigation agent."""

import json
import hashlib
import logging
from typing import Optional, List, Dict, Any

import psycopg2
from psycopg2.extras import RealDictCursor

from config import PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD

logger = logging.getLogger(__name__)


def get_connection():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, database=PG_DATABASE,
        user=PG_USER, password=PG_PASSWORD
    )


class PostgresClient:
    def __init__(self):
        self.conn = get_connection()

    def _reconnect(self):
        try:
            self.conn.close()
        except Exception:
            pass
        self.conn = get_connection()

    def _execute(self, query: str, params=None, fetch=True):
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, params)
                if fetch:
                    return cur.fetchall()
                self.conn.commit()
                return None
        except psycopg2.Error as e:
            self.conn.rollback()
            logger.error(f"DB error: {e}")
            self._reconnect()
            raise

    def search_fulltext(self, query: str, limit: int = 50) -> List[Dict]:
        """Full-text search across documents using ts_rank."""
        return self._execute("""
            SELECT id, filename, source, doc_type,
                   ts_rank(search_vector, plainto_tsquery('english', %s)) as rank,
                   LEFT(metadata->>'text', 500) as text_preview
            FROM documents
            WHERE search_vector @@ plainto_tsquery('english', %s)
            ORDER BY rank DESC
            LIMIT %s
        """, (query, query, limit))

    def get_documents_by_ids(self, ids: List[str]) -> List[Dict]:
        """Batch fetch documents by ID."""
        if not ids:
            return []
        return self._execute("""
            SELECT id, filename, source, doc_type, metadata
            FROM documents
            WHERE id = ANY(%s::uuid[])
        """, (ids,))

    def get_document_text(self, doc_id: str) -> Optional[str]:
        """Get the full text of a document."""
        rows = self._execute("""
            SELECT metadata->>'text' as text
            FROM documents WHERE id = %s
        """, (doc_id,))
        return rows[0]['text'] if rows else None

    def search_documents_by_person(self, name: str, limit: int = 100) -> List[Dict]:
        """Search documents mentioning a person's name."""
        return self._execute("""
            SELECT id, filename, source, doc_type,
                   ts_rank(search_vector, plainto_tsquery('english', %s)) as rank,
                   LEFT(metadata->>'text', 500) as text_preview
            FROM documents
            WHERE search_vector @@ plainto_tsquery('english', %s)
              AND metadata->>'text' IS NOT NULL
            ORDER BY rank DESC
            LIMIT %s
        """, (name, name, limit))

    def get_investigation_notes(self, subject: str) -> List[Dict]:
        """Get existing investigation notes for a subject."""
        return self._execute("""
            SELECT id, subject, content, classification, source_documents, created_at
            FROM investigation_notes
            WHERE subject ILIKE %s
            ORDER BY created_at DESC
        """, (f'%{subject}%',))

    def get_document_stats(self) -> Dict:
        """Get basic document statistics."""
        rows = self._execute("""
            SELECT
                COUNT(*) as total_documents,
                COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
                COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as indexed,
                COUNT(DISTINCT source) as sources
            FROM documents
        """)
        return dict(rows[0]) if rows else {}

    def search_by_date_range(self, start_year: int, end_year: int, query: str = None, limit: int = 50) -> List[Dict]:
        """Search documents by date range, optionally filtered by text query."""
        if query:
            return self._execute("""
                SELECT id, filename, source, doc_type,
                       metadata->>'date' as doc_date,
                       LEFT(metadata->>'text', 500) as text_preview
                FROM documents
                WHERE search_vector @@ plainto_tsquery('english', %s)
                  AND metadata->>'text' IS NOT NULL
                ORDER BY metadata->>'date' ASC
                LIMIT %s
            """, (query, limit))
        return self._execute("""
            SELECT id, filename, source, doc_type,
                   metadata->>'date' as doc_date,
                   LEFT(metadata->>'text', 500) as text_preview
            FROM documents
            WHERE metadata->>'text' IS NOT NULL
            ORDER BY filename ASC
            LIMIT %s
        """, (limit,))

    def get_metadata_stats(self, field: str, limit: int = 20) -> List[Dict]:
        """Get frequency distribution of a metadata field."""
        return self._execute("""
            SELECT metadata->>%s as value, COUNT(*) as count
            FROM documents
            WHERE metadata->>%s IS NOT NULL
            GROUP BY metadata->>%s
            ORDER BY count DESC
            LIMIT %s
        """, (field, field, field, limit))

    # Investigation state persistence

    def create_investigation(self, name: str, playbook: str, target: Dict, parameters: Dict = None) -> str:
        """Create a new investigation record. Returns investigation ID."""
        rows = self._execute("""
            INSERT INTO investigations (name, playbook, target, parameters)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (name, playbook, json.dumps(target), json.dumps(parameters or {})))
        self.conn.commit()
        return str(rows[0]['id'])

    def get_investigation(self, inv_id: str) -> Optional[Dict]:
        """Get investigation state."""
        rows = self._execute("""
            SELECT * FROM investigations WHERE id = %s
        """, (inv_id,))
        return dict(rows[0]) if rows else None

    def update_investigation(self, inv_id: str, **kwargs):
        """Update investigation fields. Accepts: status, state, steps, findings, decision_points, model_usage."""
        allowed = {'status', 'state', 'steps', 'findings', 'decision_points', 'model_usage'}
        updates = []
        values = []
        for key, val in kwargs.items():
            if key not in allowed:
                continue
            updates.append(f"{key} = %s")
            values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)

        if not updates:
            return
        updates.append("updated_at = NOW()")
        values.append(inv_id)

        self._execute(
            f"UPDATE investigations SET {', '.join(updates)} WHERE id = %s",
            values, fetch=False
        )

    def complete_investigation(self, inv_id: str):
        """Mark investigation as completed."""
        self._execute("""
            UPDATE investigations SET status = 'completed', completed_at = NOW(), updated_at = NOW()
            WHERE id = %s
        """, (inv_id,), fetch=False)

    def list_investigations(self, status: str = None, limit: int = 20) -> List[Dict]:
        """List investigations, optionally filtered by status."""
        if status:
            return self._execute("""
                SELECT id, name, playbook, status, target, created_at, updated_at
                FROM investigations WHERE status = %s
                ORDER BY updated_at DESC LIMIT %s
            """, (status, limit))
        return self._execute("""
            SELECT id, name, playbook, status, target, created_at, updated_at
            FROM investigations ORDER BY updated_at DESC LIMIT %s
        """, (limit,))

    # Findings with dedup

    def store_finding(self, investigation_id: str, finding_type: str, title: str,
                      description: str, evidence: List[Dict], entities: List[str],
                      confidence: float, model_source: str) -> bool:
        """Store a finding with content-hash dedup. Returns True if inserted, False if duplicate."""
        content_hash = hashlib.md5(
            (title.strip().lower() + '|' + '|'.join(sorted(entities))).encode()
        ).hexdigest()

        try:
            self._execute("""
                INSERT INTO investigation_findings
                    (investigation_id, finding_type, content_hash, title, description,
                     evidence, entities, confidence, model_source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (investigation_id, content_hash) DO NOTHING
            """, (investigation_id, finding_type, content_hash, title, description,
                  json.dumps(evidence), json.dumps(entities), confidence, model_source),
                fetch=False)
            return True
        except Exception as e:
            logger.warning(f"Finding store error: {e}")
            return False

    def get_findings(self, investigation_id: str) -> List[Dict]:
        """Get all findings for an investigation."""
        return self._execute("""
            SELECT * FROM investigation_findings
            WHERE investigation_id = %s
            ORDER BY confidence DESC, created_at ASC
        """, (investigation_id,))

    def insert_investigation_note(self, subject: str, content: str, classification: str,
                                   source_docs: List[str] = None):
        """Insert a note into the investigation_notes table."""
        self._execute("""
            INSERT INTO investigation_notes (subject, content, classification, source_documents)
            VALUES (%s, %s, %s, %s)
        """, (subject, content, classification, json.dumps(source_docs or [])), fetch=False)

    def close(self):
        self.conn.close()
