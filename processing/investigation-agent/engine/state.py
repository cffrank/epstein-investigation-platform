"""Investigation state machine with DB persistence."""

import json
import logging
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field, asdict

from db.postgres import PostgresClient

logger = logging.getLogger(__name__)


@dataclass
class Step:
    name: str
    action: str          # e.g., 'search_person', 'analyze_summaries'
    tier: str            # 'bulk', 'reasoning', 'deep'
    description: str
    status: str = 'pending'  # pending, running, completed, failed, skipped
    result: Any = None
    error: str = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class DecisionPoint:
    message: str
    options: List[Dict]  # [{label: str, description: str}]
    step_index: int
    response: str = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class Investigation:
    def __init__(self, pg: PostgresClient, inv_id: str = None, data: Dict = None):
        self.pg = pg
        self.id = inv_id
        self._data = data or {}

    @property
    def name(self) -> str:
        return self._data.get('name', '')

    @property
    def playbook(self) -> str:
        return self._data.get('playbook', '')

    @property
    def status(self) -> str:
        return self._data.get('status', 'planning')

    @property
    def target(self) -> Dict:
        t = self._data.get('target', {})
        return t if isinstance(t, dict) else {}

    @property
    def parameters(self) -> Dict:
        p = self._data.get('parameters', {})
        return p if isinstance(p, dict) else {}

    @property
    def state(self) -> Dict:
        s = self._data.get('state', {})
        return s if isinstance(s, dict) else {}

    @property
    def steps(self) -> List[Step]:
        raw = self._data.get('steps', [])
        if isinstance(raw, str):
            raw = json.loads(raw)
        return [Step.from_dict(s) if isinstance(s, dict) else s for s in raw]

    @property
    def findings(self) -> List[Dict]:
        f = self._data.get('findings', [])
        if isinstance(f, str):
            f = json.loads(f)
        return f

    @property
    def decision_points(self) -> List[DecisionPoint]:
        raw = self._data.get('decision_points', [])
        if isinstance(raw, str):
            raw = json.loads(raw)
        return [DecisionPoint.from_dict(d) if isinstance(d, dict) else d for d in raw]

    @property
    def model_usage(self) -> Dict:
        u = self._data.get('model_usage', {})
        if isinstance(u, str):
            u = json.loads(u)
        return u

    @classmethod
    def create(cls, pg: PostgresClient, name: str, playbook: str,
               target: Dict, parameters: Dict = None) -> 'Investigation':
        inv_id = pg.create_investigation(name, playbook, target, parameters)
        data = pg.get_investigation(inv_id)
        return cls(pg, inv_id, data)

    @classmethod
    def resume(cls, pg: PostgresClient, inv_id: str) -> Optional['Investigation']:
        data = pg.get_investigation(inv_id)
        if not data:
            return None
        return cls(pg, inv_id, data)

    def set_status(self, status: str):
        self._data['status'] = status
        self.pg.update_investigation(self.id, status=status)

    def set_steps(self, steps: List[Step]):
        self._data['steps'] = [s.to_dict() for s in steps]
        self.pg.update_investigation(self.id, steps=self._data['steps'])

    def update_step(self, index: int, **kwargs):
        steps = self.steps
        if index >= len(steps):
            return
        step = steps[index]
        for k, v in kwargs.items():
            if hasattr(step, k):
                setattr(step, k, v)
        self._data['steps'] = [s.to_dict() for s in steps]
        self.pg.update_investigation(self.id, steps=self._data['steps'])

    def save_state(self, state: Dict):
        self._data['state'] = state
        self.pg.update_investigation(self.id, state=state)

    def add_finding_ref(self, finding_summary: Dict):
        findings = self.findings
        findings.append(finding_summary)
        self._data['findings'] = findings
        self.pg.update_investigation(self.id, findings=findings)

    def add_decision_point(self, dp: DecisionPoint):
        dps = self.decision_points
        dps.append(dp)
        self._data['decision_points'] = [d.to_dict() for d in dps]
        self.pg.update_investigation(self.id, decision_points=self._data['decision_points'])
        self.set_status('awaiting_decision')

    def resolve_decision(self, response: str):
        dps = self.decision_points
        if dps:
            dps[-1].response = response
            self._data['decision_points'] = [d.to_dict() for d in dps]
            self.pg.update_investigation(self.id, decision_points=self._data['decision_points'])
        self.set_status('executing')

    def update_model_usage(self, usage: Dict):
        self._data['model_usage'] = usage
        self.pg.update_investigation(self.id, model_usage=usage)

    def complete(self):
        self.pg.complete_investigation(self.id)
        self._data['status'] = 'completed'

    def current_step_index(self) -> int:
        """Return index of first non-completed step."""
        for i, step in enumerate(self.steps):
            if step.status in ('pending', 'running'):
                return i
        return len(self.steps)
