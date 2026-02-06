"""Tiered model routing for investigation tasks."""

import logging
from typing import Optional, Dict

from llm.workers_ai import WorkersAIClient
from llm.claude import ClaudeClient

logger = logging.getLogger(__name__)

# Task tier definitions
BULK_TASKS = {'summarize', 'classify', 'extract_claims', 'extract_dates', 'extract_entities_quick'}
REASONING_TASKS = {'analyze_pattern', 'validate_finding', 'compare_accounts', 'assess_relevance'}
DEEP_TASKS = {'synthesize', 'assess_credibility', 'generate_plan', 'deep_analysis', 'profile_assessment'}


class LLMRouter:
    def __init__(self):
        self.workers = WorkersAIClient()
        self.claude = ClaudeClient()

    def route(self, task: str, system: str, prompt: str,
              max_tokens: int = 2048) -> Optional[str]:
        """Route a task to the appropriate model tier."""
        if task in BULK_TASKS:
            result = self.workers.generate(prompt, system, min(max_tokens, 1024))
            if result and len(result.strip()) > 20:
                return result
            # Escalate to Sonnet if Workers AI gives low-quality output
            logger.info(f"Escalating '{task}' from Workers AI to Sonnet")
            return self.claude.sonnet(system, prompt, max_tokens)

        elif task in REASONING_TASKS:
            return self.claude.sonnet(system, prompt, max_tokens)

        elif task in DEEP_TASKS:
            return self.claude.opus(system, prompt, max_tokens)

        else:
            # Default to Sonnet for unknown tasks
            logger.warning(f"Unknown task type '{task}', routing to Sonnet")
            return self.claude.sonnet(system, prompt, max_tokens)

    def bulk(self, system: str, prompt: str, max_tokens: int = 1024) -> Optional[str]:
        """Direct call to bulk tier (Workers AI)."""
        return self.workers.generate(prompt, system, max_tokens)

    def reason(self, system: str, prompt: str, max_tokens: int = 4096) -> Optional[str]:
        """Direct call to reasoning tier (Sonnet)."""
        return self.claude.sonnet(system, prompt, max_tokens)

    def deep(self, system: str, prompt: str, max_tokens: int = 8192) -> Optional[str]:
        """Direct call to deep analysis tier (Opus)."""
        return self.claude.opus(system, prompt, max_tokens)

    def get_usage(self) -> Dict:
        return {
            'workers_ai': self.workers.get_usage(),
            **self.claude.get_usage(),
        }
