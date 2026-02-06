"""Connection map playbook - map hidden connections between entities."""

from typing import List, Dict
from engine.state import Step
from playbooks.base import Playbook


class ConnectionMapPlaybook(Playbook):
    name = 'connection_map'
    description = 'Map connections between two or more entities'

    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        a = target.get('entity_a', 'Entity A')
        b = target.get('entity_b', 'Entity B')
        return [
            Step(
                name=f"Graph paths: {a} <-> {b}",
                action='find_connections',
                tier='bulk',
                description=f"Find Neo4j shortest paths between '{a}' and '{b}'"
            ),
            Step(
                name=f"Co-mentioned with {a}",
                action='get_co_mentioned',
                tier='bulk',
                description=f"Find entities frequently co-mentioned with '{a}'"
            ),
            Step(
                name=f"Entity network: {a}",
                action='get_entity_network',
                tier='bulk',
                description=f"Get full entity network for '{a}'"
            ),
            Step(
                name="Decision: Analyze intermediaries?",
                action='decision_continue',
                tier='bulk',
                description="Review paths and shared documents, decide on deep analysis"
            ),
            Step(
                name="Connection analysis",
                action='analyze_connections',
                tier='reasoning',
                description="Analyze intermediary entities and connection strength"
            ),
            Step(
                name="Extract findings",
                action='extract_findings',
                tier='reasoning',
                description="Extract connection findings"
            ),
            Step(
                name="Connection synthesis",
                action='synthesize',
                tier='deep',
                description="Synthesize connection assessment"
            ),
        ]
