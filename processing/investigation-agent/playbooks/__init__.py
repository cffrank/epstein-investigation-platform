from playbooks.base import Playbook
from playbooks.person_profile import PersonProfilePlaybook
from playbooks.connection_map import ConnectionMapPlaybook
from playbooks.document_triage import DocumentTriagePlaybook
from playbooks.timeline import TimelinePlaybook
from playbooks.anomaly_detection import AnomalyDetectionPlaybook
from playbooks.free_form import FreeFormPlaybook

PLAYBOOK_REGISTRY = {
    'person_profile': PersonProfilePlaybook,
    'connection_map': ConnectionMapPlaybook,
    'document_triage': DocumentTriagePlaybook,
    'timeline': TimelinePlaybook,
    'anomaly_detection': AnomalyDetectionPlaybook,
    'free_form': FreeFormPlaybook,
}
