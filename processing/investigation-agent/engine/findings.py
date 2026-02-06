"""Finding management with dedup and storage."""

import json
import logging
from typing import List, Dict, Optional

from db.postgres import PostgresClient

logger = logging.getLogger(__name__)


class FindingManager:
    def __init__(self, pg: PostgresClient, investigation_id: str):
        self.pg = pg
        self.investigation_id = investigation_id
        self.count = 0

    def add(self, finding_type: str, title: str, description: str,
            evidence: List[Dict] = None, entities: List[str] = None,
            confidence: float = 0.5, model_source: str = 'unknown') -> bool:
        """Add a finding with dedup. Returns True if new, False if duplicate."""
        inserted = self.pg.store_finding(
            self.investigation_id, finding_type, title, description,
            evidence or [], entities or [], confidence, model_source
        )
        if inserted:
            self.count += 1
            logger.info(f"Finding #{self.count}: {title} (confidence={confidence:.2f})")
        return inserted

    def get_all(self) -> List[Dict]:
        """Get all findings for this investigation."""
        return self.pg.get_findings(self.investigation_id)

    def summarize(self) -> str:
        """Generate a text summary of all findings."""
        findings = self.get_all()
        if not findings:
            return "No findings recorded."

        lines = [f"Total findings: {len(findings)}\n"]
        for i, f in enumerate(findings, 1):
            conf = f.get('confidence', 0)
            conf_label = 'HIGH' if conf >= 0.8 else 'MEDIUM' if conf >= 0.5 else 'LOW'
            lines.append(f"{i}. [{conf_label}] {f['title']}")
            lines.append(f"   Type: {f['finding_type']} | Model: {f['model_source']}")
            lines.append(f"   {f['description'][:200]}")
            entities = f.get('entities', [])
            if isinstance(entities, str):
                entities = json.loads(entities)
            if entities:
                lines.append(f"   Entities: {', '.join(entities[:10])}")
            lines.append("")

        return '\n'.join(lines)
