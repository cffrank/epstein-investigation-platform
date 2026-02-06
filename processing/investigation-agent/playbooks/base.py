"""Abstract base class for investigation playbooks."""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional

from engine.state import Step


class Playbook(ABC):
    """Base class for all investigation playbooks."""

    name: str = 'base'
    description: str = 'Base playbook'

    @abstractmethod
    def plan(self, target: Dict, parameters: Dict = None) -> List[Step]:
        """Generate the list of steps for this investigation."""
        pass

    def adapt_plan(self, step_index: int, result: Dict,
                   remaining_steps: List[Step], decision: str = None) -> List[Step]:
        """Optionally adapt remaining steps based on a decision or result.
        Default: no adaptation, return remaining steps unchanged."""
        return remaining_steps
