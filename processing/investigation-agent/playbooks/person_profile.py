"""Person profile playbook - deep dive on a person."""

from typing import List, Dict
from engine.state import Step
from playbooks.base import Playbook


class PersonProfilePlaybook(Playbook):
    name = 'person_profile'
    description = 'Deep dive investigation on a specific person'

    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        name = target.get('name', 'Unknown')
        return [
            Step(
                name=f"Entity lookup: {name}",
                action='get_entity_network',
                tier='bulk',
                description=f"Search Neo4j for entity '{name}' and connected entities"
            ),
            Step(
                name=f"Document search: {name}",
                action='search_person',
                tier='bulk',
                description=f"Full-text search for documents mentioning '{name}'"
            ),
            Step(
                name="Existing intelligence",
                action='get_investigation_notes',
                tier='bulk',
                description="Check for existing investigation notes"
            ),
            Step(
                name=f"VLM visual analysis: {name}",
                action='search_vlm',
                tier='bulk',
                description=f"Search VLM-extracted OCR text and people descriptions for '{name}'"
            ),
            Step(
                name="Co-mentioned entities",
                action='get_co_mentioned',
                tier='bulk',
                description="Find entities frequently co-mentioned with target"
            ),
            Step(
                name="Batch summarize documents",
                action='bulk_summarize',
                tier='bulk',
                description=f"Summarize key documents mentioning {name}. Focus on: their role, actions described, dates mentioned, and connections to other people."
            ),
            Step(
                name="Decision: Continue analysis?",
                action='decision_continue',
                tier='bulk',
                description="Present findings and ask whether to continue with deep analysis"
            ),
            Step(
                name="Pattern analysis",
                action='analyze_patterns',
                tier='reasoning',
                description="Analyze document summaries for patterns and contradictions"
            ),
            Step(
                name="Connection analysis",
                action='analyze_connections',
                tier='reasoning',
                description="Analyze entity connections for significance"
            ),
            Step(
                name="Extract findings",
                action='extract_findings',
                tier='reasoning',
                description="Extract and store individual findings from analyses"
            ),
            Step(
                name="Profile synthesis",
                action='synthesize',
                tier='deep',
                description="Synthesize all findings into a comprehensive profile assessment"
            ),
        ]

    def adapt_plan(self, step_index: int, result: Dict,
                   remaining_steps: List[Step], decision: str = None) -> List[Step]:
        if decision == '4':
            # Skip to synthesis
            return [s for s in remaining_steps if s.action == 'synthesize']
        return remaining_steps
