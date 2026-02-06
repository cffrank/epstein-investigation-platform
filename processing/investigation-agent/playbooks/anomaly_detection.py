"""Anomaly detection playbook - find statistical outliers."""

from typing import List, Dict
from engine.state import Step
from playbooks.base import Playbook


class AnomalyDetectionPlaybook(Playbook):
    name = 'anomaly_detection'
    description = 'Find statistical anomalies and outliers in the document corpus'

    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        return [
            Step(
                name="Source distribution stats",
                action='get_metadata_stats',
                tier='bulk',
                description="Get frequency distribution of document sources"
            ),
            Step(
                name="Entity hub analysis",
                action='get_hub_entities',
                tier='bulk',
                description="Find entities with unusually high document connections"
            ),
            Step(
                name="Entity network: top hub",
                action='get_entity_network',
                tier='bulk',
                description="Get network for the top hub entity"
            ),
            Step(
                name="Anomaly analysis",
                action='analyze_patterns',
                tier='reasoning',
                description="Analyze statistics for anomalies: unusual frequencies, missing data patterns, unexpected entity clusters"
            ),
            Step(
                name="Decision: Investigate which anomalies?",
                action='decision_continue',
                tier='bulk',
                description="Review detected anomalies and choose which to investigate"
            ),
            Step(
                name="Deep anomaly investigation",
                action='analyze_connections',
                tier='reasoning',
                description="Deep investigation of selected anomalies"
            ),
            Step(
                name="Extract findings",
                action='extract_findings',
                tier='reasoning',
                description="Extract anomaly findings"
            ),
            Step(
                name="Anomaly synthesis",
                action='synthesize',
                tier='deep',
                description="Synthesize anomaly detection results"
            ),
        ]
