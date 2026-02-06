"""Document triage playbook - surface key documents by topic."""

from typing import List, Dict
from engine.state import Step
from playbooks.base import Playbook


class DocumentTriagePlaybook(Playbook):
    name = 'document_triage'
    description = 'Surface and rank the most important documents on a topic'

    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        query = target.get('query', 'unknown topic')
        return [
            Step(
                name=f"Full-text search: {query}",
                action='search_fulltext',
                tier='bulk',
                description=f"Full-text search for '{query}' across all documents"
            ),
            Step(
                name=f"Semantic search: {query}",
                action='search_documents_topic',
                tier='bulk',
                description=f"Combined semantic + fulltext search for '{query}'"
            ),
            Step(
                name="Classify relevance",
                action='classify_relevance',
                tier='bulk',
                description=f"Use Workers AI to classify and rank documents by relevance to '{query}'"
            ),
            Step(
                name="Batch summarize top docs",
                action='bulk_summarize',
                tier='bulk',
                description=f"Summarize top documents about '{query}'"
            ),
            Step(
                name="Decision: Review clusters?",
                action='decision_continue',
                tier='bulk',
                description="Review top documents and decide on deep analysis"
            ),
            Step(
                name="Pattern analysis",
                action='analyze_patterns',
                tier='reasoning',
                description="Analyze summaries for key themes and important documents"
            ),
            Step(
                name="Extract findings",
                action='extract_findings',
                tier='reasoning',
                description="Extract key document findings"
            ),
            Step(
                name="Triage synthesis",
                action='synthesize',
                tier='deep',
                description="Synthesize document triage results"
            ),
        ]
