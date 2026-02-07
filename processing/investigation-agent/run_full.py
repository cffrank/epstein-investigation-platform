#!/usr/bin/env python3
"""Run a full investigation end-to-end with auto-decisions."""
import sys
import logging
sys.path.insert(0, '/app')

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(name)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('full_run')

from db.postgres import PostgresClient
from db.qdrant_client import QdrantSearchClient
from db.neo4j_client import Neo4jClient
from db.unified import UnifiedSearch
from llm.router import LLMRouter
from engine.state import Investigation, DecisionPoint
from engine.executor import Executor
from engine.findings import FindingManager
from engine.reports import generate_markdown_report, save_report
from playbooks import PLAYBOOK_REGISTRY


def auto_decide(dp: DecisionPoint) -> str:
    """Auto-select option 1 (recommended) at decision points."""
    print("\n" + "=" * 60)
    print("  DECISION POINT (auto-selecting recommended)")
    print("=" * 60)
    print(f"\n{dp.message}\n")
    for opt in dp.options:
        label = opt.get('label', '?')
        desc = opt.get('description', '')
        marker = " <-- AUTO" if label == '1' else ""
        print(f"  {label}. {desc}{marker}")
    print(f"\nAuto-selecting: 1")
    return '1'


def run():
    playbook_name = sys.argv[1] if len(sys.argv) > 1 else 'document_triage'
    target_str = sys.argv[2] if len(sys.argv) > 2 else 'flight logs'

    print(f"\n{'='*60}")
    print(f"  FULL INVESTIGATION RUN")
    print(f"  Playbook: {playbook_name}")
    print(f"  Target: {target_str}")
    print(f"{'='*60}\n")

    # Initialize
    logger.info("Connecting to databases...")
    pg = PostgresClient()
    qdrant = QdrantSearchClient()
    neo4j = Neo4jClient()
    unified = UnifiedSearch(pg, qdrant, neo4j)
    router = LLMRouter()

    # Parse target
    if playbook_name == 'person_profile':
        target = {'name': target_str}
        inv_name = f"Person Profile: {target_str}"
    elif playbook_name == 'connection_map':
        entities = [e.strip() for e in target_str.split(',')]
        target = {'entity_a': entities[0], 'entity_b': entities[1] if len(entities) > 1 else ''}
        inv_name = f"Connection Map: {' <-> '.join(entities)}"
    elif playbook_name == 'document_triage':
        target = {'query': target_str}
        inv_name = f"Document Triage: {target_str}"
    elif playbook_name == 'timeline':
        target = {'name': target_str, 'query': target_str}
        inv_name = f"Timeline: {target_str}"
    elif playbook_name == 'anomaly_detection':
        target = {'scope': target_str}
        inv_name = f"Anomaly Detection: {target_str}"
    elif playbook_name == 'free_form':
        target = {'question': target_str, 'query': target_str}
        inv_name = f"Free-form: {target_str[:80]}"
    else:
        target = {'query': target_str}
        inv_name = f"Investigation: {target_str}"

    # Create investigation
    logger.info(f"Creating investigation: {inv_name}")
    inv = Investigation.create(pg, inv_name, playbook_name, target)
    print(f"Investigation ID: {inv.id}\n")

    # Plan
    playbook = PLAYBOOK_REGISTRY[playbook_name]()
    steps = playbook.plan(target)
    inv.set_steps(steps)
    inv.set_status('executing')

    print(f"Plan ({len(steps)} steps):")
    for i, s in enumerate(steps):
        print(f"  {i+1}. [{s.tier}] {s.name}")
    print()

    # Execute with auto-decisions
    findings = FindingManager(pg, inv.id)
    executor = Executor(inv, unified, router, findings)

    logger.info("Starting execution...")
    result = executor.run(decision_callback=auto_decide)

    # Results
    print(f"\n{'='*60}")
    print(f"  EXECUTION COMPLETE")
    print(f"{'='*60}")
    print(f"Status: {result.get('status')}")
    print(f"Findings: {findings.count}")

    # Usage
    usage = router.get_usage()
    print(f"\nModel Usage:")
    wai = usage.get('workers_ai', {})
    print(f"  Workers AI: {wai.get('calls', 0)} calls, {wai.get('tokens', 0)} tokens")
    son = usage.get('sonnet', {})
    print(f"  Sonnet: {son.get('calls', 0)} calls, {son.get('input_tokens', 0)+son.get('output_tokens', 0)} tokens")
    opus = usage.get('opus', {})
    print(f"  Opus: {opus.get('calls', 0)} calls, {opus.get('input_tokens', 0)+opus.get('output_tokens', 0)} tokens")

    # Generate report
    if result.get('status') == 'completed':
        logger.info("Generating report...")
        inv_data = pg.get_investigation(inv.id)
        all_findings = pg.get_findings(inv.id)

        # Get synthesis
        state = inv_data.get('state', {})
        if isinstance(state, str):
            import json
            state = json.loads(state)
        synthesis = None
        for key in sorted(state.keys(), reverse=True):
            val = state.get(key, {})
            if isinstance(val, dict) and val.get('synthesis'):
                synthesis = val['synthesis']
                break

        report = generate_markdown_report(inv_data, all_findings, synthesis)
        filepath = save_report(str(inv_data['id']), report)

        print(f"\n{'='*60}")
        print(f"  REPORT")
        print(f"{'='*60}")
        print(report)
        print(f"\nReport saved to: {filepath}")

    # Cleanup
    pg.close()
    qdrant.close()
    neo4j.close()
    print("\nDone.")


if __name__ == '__main__':
    run()
