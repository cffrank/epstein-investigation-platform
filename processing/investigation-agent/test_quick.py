"""Quick test of the investigation agent - non-interactive."""
import sys
import logging
sys.path.insert(0, '/app')

logging.basicConfig(level=logging.INFO, format='%(name)s: %(message)s')

from config import *
from db.postgres import PostgresClient
from db.qdrant_client import QdrantSearchClient
from db.neo4j_client import Neo4jClient
from db.unified import UnifiedSearch
from llm.workers_ai import WorkersAIClient
from llm.router import LLMRouter
from engine.state import Investigation
from engine.executor import Executor
from engine.findings import FindingManager
from playbooks import PLAYBOOK_REGISTRY

def test():
    print("=== Investigation Agent Quick Test ===\n")

    # 1. Test DB connections
    print("1. Testing database connections...")
    pg = PostgresClient()
    stats = pg.get_document_stats()
    total = stats.get('total_documents', 0)
    indexed = stats.get('indexed', 0)
    print(f"   PostgreSQL: {total} documents, {indexed} indexed for fulltext")

    qdrant = QdrantSearchClient()
    info = qdrant.get_collection_info()
    print(f"   Qdrant: {info.get('points_count', 0)} points")

    neo4j = Neo4jClient()
    neo_stats = neo4j.get_entity_stats()
    print(f"   Neo4j: {neo_stats}")

    # 2. Test fulltext search
    print("\n2. Testing PostgreSQL fulltext search...")
    ft_results = pg.search_fulltext("flight logs", 5)
    print(f"   Fulltext results: {len(ft_results)}")
    if ft_results:
        for r in ft_results[:3]:
            print(f"     - {r.get('filename')} (rank: {r.get('rank', 0):.4f})")

    # 3. Test unified search
    print("\n3. Testing unified document search...")
    unified = UnifiedSearch(pg, qdrant, neo4j)
    results = unified.search_documents("flight logs", limit=5)
    print(f"   Fulltext: {len(results.get('fulltext', []))}")
    print(f"   Merged: {len(results.get('merged', []))}")

    # 4. Test Workers AI
    print("\n4. Testing Workers AI...")
    wai = WorkersAIClient()
    try:
        resp = wai.generate(
            "Summarize in one sentence: Jeffrey Epstein flight logs show travel patterns.",
            max_tokens=100
        )
        print(f"   Workers AI OK: {resp[:200]}")
    except Exception as e:
        print(f"   Workers AI error: {e}")

    # 5. Test LLM Router
    print("\n5. Testing LLM Router...")
    try:
        router = LLMRouter()
        bulk_result = router.bulk(
            "You are a document classifier.",
            "Classify this text as RELEVANT or IRRELEVANT to flight records: "
            "Flight manifest showing passengers on private jet from Teterboro to Palm Beach.",
            100
        )
        print(f"   Bulk routing OK: {bulk_result[:200]}")
    except Exception as e:
        print(f"   Router init error: {e}")
        print("   Skipping router-dependent tests.")
        pg.close()
        qdrant.close()
        neo4j.close()
        return

    # 6. Create investigation (following agent.py pattern)
    print("\n6. Creating investigation...")
    target = {'query': 'flight logs'}
    inv = Investigation.create(pg, "Test Flight Logs Triage", "document_triage", target)
    print(f"   Investigation ID: {inv.id}")

    # Generate plan from playbook
    playbook = PLAYBOOK_REGISTRY['document_triage']()
    steps = playbook.plan(target)
    inv.set_steps(steps)
    inv.set_status('executing')

    print(f"   Status: {inv.status}")
    print(f"   Steps ({len(steps)}):")
    for i, s in enumerate(steps):
        print(f"     {i+1}. [{s.tier}] {s.name} ({s.action})")

    # 7. Run first 3 steps (bulk operations, before decision point)
    print("\n7. Running first 3 steps...")
    findings = FindingManager(pg, inv.id)
    executor = Executor(inv, unified, router, findings)

    for i in range(min(3, len(steps))):
        step = inv.steps[i]
        if step.status != 'pending':
            continue
        print(f"\n   Step {i+1}: {step.name} [{step.action}]...")
        try:
            result = executor._execute_step(step)
            inv.update_step(i, status='completed', result=result)
            executor.context[f'step_{i}_result'] = result
            print(f"   Completed!")
            if result:
                result_str = str(result)
                print(f"   Result: {result_str[:500]}")
        except Exception as e:
            print(f"   Failed: {e}")
            import traceback
            traceback.print_exc()

    # Summary
    print(f"\n=== Test Complete ===")
    print(f"Investigation: {inv.id}")
    print(f"Findings: {findings.count}")
    usage = router.get_usage()
    print(f"Usage: {usage}")

    pg.close()
    qdrant.close()
    neo4j.close()

if __name__ == '__main__':
    test()
