"""Report generation for investigations."""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List

from config import REPORT_DIR

logger = logging.getLogger(__name__)


def generate_markdown_report(investigation: Dict, findings: List[Dict],
                              synthesis: str = None) -> str:
    """Generate a markdown investigation report."""
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
    target = investigation.get('target', {})
    if isinstance(target, str):
        target = json.loads(target)

    lines = [
        f"# Investigation Report: {investigation.get('name', 'Unnamed')}",
        f"",
        f"**Date:** {now}",
        f"**Playbook:** {investigation.get('playbook', 'N/A')}",
        f"**Status:** {investigation.get('status', 'N/A')}",
        f"**Target:** {json.dumps(target, indent=2) if isinstance(target, dict) else target}",
        f"",
        f"---",
        f"",
    ]

    # Synthesis section
    if synthesis:
        lines.extend([
            "## Executive Summary",
            "",
            synthesis,
            "",
            "---",
            "",
        ])

    # Findings section
    lines.extend([
        f"## Findings ({len(findings)} total)",
        "",
    ])

    high = [f for f in findings if f.get('confidence', 0) >= 0.8]
    medium = [f for f in findings if 0.5 <= f.get('confidence', 0) < 0.8]
    low = [f for f in findings if f.get('confidence', 0) < 0.5]

    for label, group in [("High Confidence", high), ("Medium Confidence", medium), ("Low Confidence", low)]:
        if not group:
            continue
        lines.append(f"### {label}")
        lines.append("")
        for f in group:
            lines.append(f"**{f['title']}** (confidence: {f.get('confidence', 0):.2f})")
            lines.append(f"")
            lines.append(f"*Type:* {f['finding_type']} | *Source:* {f.get('model_source', 'N/A')}")
            lines.append(f"")
            lines.append(f"{f['description']}")
            lines.append(f"")

            evidence = f.get('evidence', [])
            if isinstance(evidence, str):
                evidence = json.loads(evidence)
            if evidence:
                lines.append("*Evidence:*")
                for ev in evidence[:5]:
                    if isinstance(ev, dict):
                        lines.append(f"- {ev.get('filename', ev.get('document_id', 'unknown'))}: {ev.get('excerpt', '')[:200]}")
                    else:
                        lines.append(f"- {ev}")
                lines.append("")

            entities = f.get('entities', [])
            if isinstance(entities, str):
                entities = json.loads(entities)
            if entities:
                lines.append(f"*Entities:* {', '.join(entities[:15])}")
                lines.append("")

            lines.append("---")
            lines.append("")

    # Model usage
    usage = investigation.get('model_usage', {})
    if isinstance(usage, str):
        usage = json.loads(usage)
    if usage:
        lines.extend([
            "## Model Usage",
            "",
            "| Tier | Calls | Tokens |",
            "|------|-------|--------|",
        ])
        for tier, data in usage.items():
            if isinstance(data, dict):
                calls = data.get('calls', 0)
                tokens = data.get('tokens', data.get('input_tokens', 0) + data.get('output_tokens', 0))
                lines.append(f"| {tier} | {calls} | {tokens} |")
        lines.append("")

    return '\n'.join(lines)


def save_report(investigation_id: str, content: str, fmt: str = 'md') -> str:
    """Save report to filesystem. Returns file path."""
    report_dir = os.path.join(REPORT_DIR, investigation_id)
    os.makedirs(report_dir, exist_ok=True)

    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    filename = f"report_{timestamp}.{fmt}"
    filepath = os.path.join(report_dir, filename)

    with open(filepath, 'w') as f:
        f.write(content)

    logger.info(f"Report saved: {filepath}")
    return filepath


def generate_json_report(investigation: Dict, findings: List[Dict]) -> Dict:
    """Generate a machine-readable JSON report."""
    return {
        'investigation_id': str(investigation.get('id', '')),
        'name': investigation.get('name', ''),
        'playbook': investigation.get('playbook', ''),
        'status': investigation.get('status', ''),
        'target': investigation.get('target', {}),
        'generated_at': datetime.utcnow().isoformat(),
        'findings_count': len(findings),
        'findings': findings,
        'model_usage': investigation.get('model_usage', {}),
    }
