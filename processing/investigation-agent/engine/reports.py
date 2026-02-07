"""Report generation for investigations. Saves locally and uploads to S3."""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional

from config import (
    REPORT_DIR, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY,
    S3_BUCKET, S3_REGION, S3_REPORTS_PREFIX
)

logger = logging.getLogger(__name__)

_s3_client = None


def _get_s3_client():
    """Lazy-init S3 client for Hetzner Object Storage."""
    global _s3_client
    if _s3_client is not None:
        return _s3_client
    if not S3_ENDPOINT or not S3_ACCESS_KEY:
        return None
    import boto3
    from botocore.config import Config
    _s3_client = boto3.client(
        's3',
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=Config(signature_version='s3v4')
    )
    return _s3_client


def upload_to_s3(content: str, s3_key: str, content_type: str = 'text/markdown') -> Optional[str]:
    """Upload report content to S3. Returns S3 URL or None on failure."""
    client = _get_s3_client()
    if not client:
        logger.debug("S3 not configured, skipping upload")
        return None
    try:
        client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=content.encode('utf-8'),
            ContentType=content_type
        )
        url = f"{S3_ENDPOINT}/{S3_BUCKET}/{s3_key}"
        logger.info(f"Report uploaded to S3: {s3_key}")
        return url
    except Exception as e:
        logger.warning(f"S3 upload failed: {e}")
        return None


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
    """Save report locally and upload to S3. Returns local file path."""
    # Save locally
    report_dir = os.path.join(REPORT_DIR, investigation_id)
    os.makedirs(report_dir, exist_ok=True)

    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    filename = f"report_{timestamp}.{fmt}"
    filepath = os.path.join(report_dir, filename)

    with open(filepath, 'w') as f:
        f.write(content)

    logger.info(f"Report saved: {filepath}")

    # Upload to S3
    content_type = 'text/markdown' if fmt == 'md' else 'application/json'
    s3_key = f"{S3_REPORTS_PREFIX}{investigation_id}/{filename}"
    s3_url = upload_to_s3(content, s3_key, content_type)
    if s3_url:
        logger.info(f"Report uploaded: {s3_url}")

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


def save_json_report(investigation_id: str, report: Dict) -> str:
    """Save JSON report locally and upload to S3."""
    content = json.dumps(report, indent=2, default=str)
    return save_report(investigation_id, content, fmt='json')
