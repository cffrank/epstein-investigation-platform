#!/usr/bin/env python3
"""
Investigation Agent - Autonomous investigation of the Epstein document corpus.

Queries PostgreSQL (documents), Qdrant (embeddings), and Neo4j (entity graph)
using tiered AI models: Workers AI (bulk), Claude Sonnet (reasoning), Claude Opus (deep).
"""

import sys
import json
import logging
import readline  # enables arrow keys in input()

from config import ANTHROPIC_API_KEY, WORKERS_AI_URL
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

logging.basicConfig(
    level=logging.INFO,
    format='[Agent] %(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BANNER = """
================================================================
   INVESTIGATION AGENT - Epstein Document Analysis Platform
================================================================
   Documents: 1.3M+ | Entities: 88K+ | Relationships: 917K+
   Models: Workers AI (bulk) | Sonnet (reasoning) | Opus (deep)
================================================================

Commands:
  new <playbook> <target>    Start new investigation
  resume <id>                Resume paused investigation
  list                       List all investigations
  status <id>                Show investigation status
  report <id>                Generate/view report
  freeform "<question>"      Free-form investigation
  playbooks                  List available playbooks
  stats                      Show platform statistics
  quit                       Exit
"""


def print_decision(dp: DecisionPoint) -> str:
    """Display a decision point and get user input."""
    print("\n" + "=" * 60)
    print("  DECISION REQUIRED")
    print("=" * 60)
    print(f"\n{dp.message}\n")

    for opt in dp.options:
        label = opt.get('label', '?')
        desc = opt.get('description', '')
        print(f"  {label}. {desc}")

    print()
    while True:
        choice = input("Your choice [1]: ").strip() or '1'
        valid_labels = [o.get('label', '') for o in dp.options]
        if choice in valid_labels:
            return choice
        print(f"Invalid choice. Options: {', '.join(valid_labels)}")


def run_investigation(inv: Investigation, unified: UnifiedSearch, llm: LLMRouter):
    """Run an investigation with interactive decision points."""
    findings = FindingManager(inv.pg, inv.id)
    executor = Executor(inv, unified, llm, findings)

    result = executor.run(decision_callback=print_decision)

    if result.get('status') == 'completed':
        print(f"\nInvestigation completed. {findings.count} findings recorded.")
        print(f"Use 'report {inv.id}' to generate the full report.")
    elif result.get('status') == 'awaiting_decision':
        print(f"\nInvestigation paused. Resume with: resume {inv.id}")


def cmd_new(args: str, pg: PostgresClient, unified: UnifiedSearch, llm: LLMRouter):
    """Start a new investigation."""
    parts = args.split(None, 1)
    if len(parts) < 2:
        print("Usage: new <playbook> <target>")
        print(f"Playbooks: {', '.join(PLAYBOOK_REGISTRY.keys())}")
        return

    playbook_name = parts[0]
    target_str = parts[1]

    if playbook_name not in PLAYBOOK_REGISTRY:
        print(f"Unknown playbook: {playbook_name}")
        print(f"Available: {', '.join(PLAYBOOK_REGISTRY.keys())}")
        return

    # Parse target based on playbook type
    if playbook_name == 'person_profile':
        target = {'name': target_str}
        inv_name = f"Person Profile: {target_str}"
    elif playbook_name == 'connection_map':
        entities = [e.strip() for e in target_str.split(',')]
        if len(entities) < 2:
            print("Usage: new connection_map Entity A, Entity B")
            return
        target = {'entity_a': entities[0], 'entity_b': entities[1]}
        inv_name = f"Connection Map: {entities[0]} <-> {entities[1]}"
    elif playbook_name == 'document_triage':
        target = {'query': target_str}
        inv_name = f"Document Triage: {target_str}"
    elif playbook_name == 'timeline':
        target = {'name': target_str, 'query': target_str}
        inv_name = f"Timeline: {target_str}"
    elif playbook_name == 'anomaly_detection':
        target = {'scope': target_str}
        inv_name = f"Anomaly Detection: {target_str}"
    else:
        target = {'query': target_str}
        inv_name = f"Investigation: {target_str}"

    # Create investigation
    inv = Investigation.create(pg, inv_name, playbook_name, target)
    print(f"Created investigation: {inv.id}")

    # Generate plan
    playbook_cls = PLAYBOOK_REGISTRY[playbook_name]
    playbook = playbook_cls()
    steps = playbook.plan(target)
    inv.set_steps(steps)
    inv.set_status('executing')

    print(f"Plan: {len(steps)} steps")
    for i, step in enumerate(steps):
        print(f"  {i+1}. [{step.tier}] {step.name}")
    print()

    # Execute
    run_investigation(inv, unified, llm)


def cmd_freeform(question: str, pg: PostgresClient, unified: UnifiedSearch, llm: LLMRouter):
    """Start a free-form investigation."""
    target = {'question': question, 'query': question}
    inv = Investigation.create(pg, f"Free-form: {question[:80]}", 'free_form', target)
    print(f"Created investigation: {inv.id}")

    playbook = PLAYBOOK_REGISTRY['free_form']()
    steps = playbook.plan(target)
    inv.set_steps(steps)
    inv.set_status('executing')

    print(f"Plan: {len(steps)} steps")
    for i, step in enumerate(steps):
        print(f"  {i+1}. [{step.tier}] {step.name}")
    print()

    run_investigation(inv, unified, llm)


def cmd_resume(inv_id: str, pg: PostgresClient, unified: UnifiedSearch, llm: LLMRouter):
    """Resume a paused investigation."""
    inv = Investigation.resume(pg, inv_id.strip())
    if not inv:
        print(f"Investigation not found: {inv_id}")
        return

    print(f"Resuming: {inv.name} (status: {inv.status})")

    if inv.status == 'completed':
        print("Investigation already completed. Use 'report' to view.")
        return

    if inv.status == 'awaiting_decision':
        # Show the last decision point
        dps = inv.decision_points
        if dps:
            last_dp = dps[-1]
            choice = print_decision(last_dp)
            inv.resolve_decision(choice)

    run_investigation(inv, unified, llm)


def cmd_list(pg: PostgresClient):
    """List all investigations."""
    investigations = pg.list_investigations(limit=20)
    if not investigations:
        print("No investigations found.")
        return

    print(f"\n{'ID':<40} {'Status':<15} {'Playbook':<20} {'Name'}")
    print("-" * 110)
    for inv in investigations:
        inv_id = str(inv['id'])[:36]
        print(f"{inv_id:<40} {inv['status']:<15} {inv['playbook']:<20} {inv['name'][:50]}")
    print()


def cmd_status(inv_id: str, pg: PostgresClient):
    """Show investigation status."""
    data = pg.get_investigation(inv_id.strip())
    if not data:
        print(f"Investigation not found: {inv_id}")
        return

    print(f"\nInvestigation: {data['name']}")
    print(f"ID: {data['id']}")
    print(f"Status: {data['status']}")
    print(f"Playbook: {data['playbook']}")
    print(f"Created: {data['created_at']}")
    print(f"Updated: {data['updated_at']}")

    steps = data.get('steps', [])
    if isinstance(steps, str):
        steps = json.loads(steps)
    if steps:
        print(f"\nSteps ({len(steps)}):")
        for i, s in enumerate(steps):
            status_icon = {'completed': '+', 'running': '>', 'failed': 'X', 'pending': ' '}.get(s.get('status', ''), '?')
            print(f"  [{status_icon}] {i+1}. [{s.get('tier', '?')}] {s.get('name', 'unnamed')}")

    usage = data.get('model_usage', {})
    if isinstance(usage, str):
        usage = json.loads(usage)
    if usage:
        print(f"\nModel Usage:")
        for tier, u in usage.items():
            if isinstance(u, dict) and u.get('calls', 0) > 0:
                tokens = u.get('tokens', u.get('input_tokens', 0) + u.get('output_tokens', 0))
                print(f"  {tier}: {u['calls']} calls, {tokens} tokens")
    print()


def cmd_report(inv_id: str, pg: PostgresClient):
    """Generate and display a report."""
    data = pg.get_investigation(inv_id.strip())
    if not data:
        print(f"Investigation not found: {inv_id}")
        return

    findings = pg.get_findings(inv_id.strip())

    # Get synthesis from last step result if available
    state = data.get('state', {})
    if isinstance(state, str):
        state = json.loads(state)
    synthesis = None
    for key in sorted(state.keys(), reverse=True):
        val = state.get(key, {})
        if isinstance(val, dict) and val.get('synthesis'):
            synthesis = val['synthesis']
            break

    report = generate_markdown_report(data, findings, synthesis)
    print(report)

    filepath = save_report(str(data['id']), report)
    print(f"\nReport saved to: {filepath}")


def cmd_stats(unified: UnifiedSearch):
    """Show platform statistics."""
    print("\nFetching platform statistics...")
    stats = unified.get_platform_stats()

    pg = stats.get('postgres', {})
    neo4j = stats.get('neo4j_entities', {})
    qdrant = stats.get('qdrant', {})

    print(f"\nPostgreSQL:")
    print(f"  Total documents: {pg.get('total_documents', '?'):,}")
    print(f"  With text: {pg.get('has_text', '?'):,}")
    print(f"  Indexed: {pg.get('indexed', '?'):,}")
    print(f"  Sources: {pg.get('sources', '?')}")

    print(f"\nNeo4j:")
    for label, count in neo4j.items():
        if label != 'error':
            print(f"  {label}: {count:,}")

    print(f"\nQdrant ({PLAYBOOK_REGISTRY and 'v2' or ''}):")
    print(f"  Points: {qdrant.get('points_count', '?'):,}")
    print(f"  Indexed: {qdrant.get('indexed_vectors_count', '?'):,}")
    print()


def test_connections(pg, qdrant, neo4j):
    """Test database connections on startup."""
    errors = []

    try:
        pg.get_document_stats()
        print("  PostgreSQL: connected")
    except Exception as e:
        print(f"  PostgreSQL: FAILED - {e}")
        errors.append('postgres')

    try:
        qdrant.get_collection_info()
        print("  Qdrant: connected")
    except Exception as e:
        print(f"  Qdrant: FAILED - {e}")
        errors.append('qdrant')

    try:
        neo4j.get_entity_stats()
        print("  Neo4j: connected")
    except Exception as e:
        print(f"  Neo4j: FAILED - {e}")
        errors.append('neo4j')

    return errors


def main():
    print(BANNER)

    # Validate critical config
    if not ANTHROPIC_API_KEY:
        print("WARNING: ANTHROPIC_API_KEY not set. Claude models will not work.")

    # Initialize clients
    print("Connecting to databases...")
    pg = PostgresClient()
    qdrant = QdrantSearchClient()
    neo4j = Neo4jClient()

    errors = test_connections(pg, qdrant, neo4j)
    if errors:
        print(f"\nWARNING: Failed connections: {', '.join(errors)}")
        print("Some features may not work.\n")
    else:
        print("All databases connected.\n")

    unified = UnifiedSearch(pg, qdrant, neo4j)
    llm = LLMRouter()

    # Interactive loop
    while True:
        try:
            line = input("investigate> ").strip()
            if not line:
                continue

            cmd, _, args = line.partition(' ')
            cmd = cmd.lower()

            if cmd in ('quit', 'exit', 'q'):
                break
            elif cmd == 'new':
                cmd_new(args, pg, unified, llm)
            elif cmd == 'freeform':
                cmd_freeform(args.strip('"\''), pg, unified, llm)
            elif cmd == 'resume':
                cmd_resume(args, pg, unified, llm)
            elif cmd == 'list':
                cmd_list(pg)
            elif cmd == 'status':
                cmd_status(args, pg)
            elif cmd == 'report':
                cmd_report(args, pg)
            elif cmd == 'stats':
                cmd_stats(unified)
            elif cmd == 'playbooks':
                print("\nAvailable playbooks:")
                for name, cls in PLAYBOOK_REGISTRY.items():
                    print(f"  {name:<25} {cls.description}")
                print()
            elif cmd == 'help':
                print(BANNER)
            else:
                print(f"Unknown command: {cmd}. Type 'help' for commands.")

        except KeyboardInterrupt:
            print("\n(Use 'quit' to exit)")
            continue
        except EOFError:
            break
        except Exception as e:
            logger.error(f"Error: {e}", exc_info=True)
            print(f"Error: {e}")

    print("\nShutting down...")
    pg.close()
    qdrant.close()
    neo4j.close()


if __name__ == '__main__':
    main()
