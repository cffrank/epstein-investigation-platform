"""Free-form playbook - open-ended investigation driven by Opus."""

import json
import logging
from typing import List, Dict
from engine.state import Step
from playbooks.base import Playbook

logger = logging.getLogger(__name__)


class FreeFormPlaybook(Playbook):
    name = 'free_form'
    description = 'Open-ended investigation driven by a natural language question'

    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        """Start with a planning step, then generate dynamic steps."""
        return [
            Step(
                name="Generate investigation plan",
                action='generate_plan',
                tier='deep',
                description="Use Opus to analyze the question and generate an investigation plan"
            ),
            # After the plan is generated, the executor will use adapt_plan
            # to inject the generated steps. For now, include generic follow-up:
            Step(
                name="Full-text search",
                action='search_fulltext',
                tier='bulk',
                description="Search documents for terms from the generated plan"
            ),
            Step(
                name="Entity search",
                action='get_entity_network',
                tier='bulk',
                description="Search entity graph for relevant entities"
            ),
            Step(
                name="Batch summarize",
                action='bulk_summarize',
                tier='bulk',
                description="Summarize discovered documents"
            ),
            Step(
                name="Decision: Continue?",
                action='decision_continue',
                tier='bulk',
                description="Review initial results and decide direction"
            ),
            Step(
                name="Pattern analysis",
                action='analyze_patterns',
                tier='reasoning',
                description="Analyze patterns in discovered evidence"
            ),
            Step(
                name="Extract findings",
                action='extract_findings',
                tier='reasoning',
                description="Extract findings from analysis"
            ),
            Step(
                name="Final synthesis",
                action='synthesize',
                tier='deep',
                description="Synthesize all findings into a comprehensive answer"
            ),
        ]
