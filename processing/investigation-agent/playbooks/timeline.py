"""Timeline playbook - chronological event mapping."""

from typing import List, Dict
from engine.state import Step
from playbooks.base import Playbook


class TimelinePlaybook(Playbook):
    name = 'timeline'
    description = 'Reconstruct a chronological timeline of events'

    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        name = target.get('name', target.get('query', 'Unknown'))
        return [
            Step(
                name=f"Document search: {name}",
                action='search_person',
                tier='bulk',
                description=f"Find documents mentioning '{name}'"
            ),
            Step(
                name=f"Entity network: {name}",
                action='get_entity_network',
                tier='bulk',
                description=f"Get entity connections for '{name}'"
            ),
            Step(
                name="Batch summarize with dates",
                action='bulk_summarize',
                tier='bulk',
                description=f"Summarize documents mentioning '{name}'. Extract ALL dates, times, and chronological references. Format: DATE: [date] EVENT: [what happened]"
            ),
            Step(
                name="Decision: Focus period?",
                action='decision_continue',
                tier='bulk',
                description="Review date range covered. Choose focus period or continue."
            ),
            Step(
                name="Timeline analysis",
                action='analyze_patterns',
                tier='reasoning',
                description="Reconstruct chronological timeline from summaries. Order events by date."
            ),
            Step(
                name="Extract findings",
                action='extract_findings',
                tier='reasoning',
                description="Extract timeline events as findings"
            ),
            Step(
                name="Timeline synthesis",
                action='synthesize',
                tier='deep',
                description="Synthesize complete chronological narrative"
            ),
        ]
