"""Anthropic Claude API client for reasoning and deep analysis."""

import logging
from typing import Optional, Dict, List

import anthropic

from config import ANTHROPIC_API_KEY, CLAUDE_SONNET_MODEL, CLAUDE_OPUS_MODEL

logger = logging.getLogger(__name__)


class ClaudeClient:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        self.sonnet_model = CLAUDE_SONNET_MODEL
        self.opus_model = CLAUDE_OPUS_MODEL
        self.usage = {
            'sonnet': {'calls': 0, 'input_tokens': 0, 'output_tokens': 0},
            'opus': {'calls': 0, 'input_tokens': 0, 'output_tokens': 0},
        }

    def chat(self, model: str, system: str, messages: List[Dict],
             max_tokens: int = 4096) -> Optional[str]:
        """Send a chat request to Claude."""
        try:
            response = self.client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
            )

            tier = 'opus' if 'opus' in model else 'sonnet'
            self.usage[tier]['calls'] += 1
            self.usage[tier]['input_tokens'] += response.usage.input_tokens
            self.usage[tier]['output_tokens'] += response.usage.output_tokens

            return response.content[0].text

        except anthropic.RateLimitError:
            logger.warning(f"Claude rate limited ({model})")
            return None
        except anthropic.APIError as e:
            logger.error(f"Claude API error: {e}")
            return None
        except Exception as e:
            logger.error(f"Claude error: {e}")
            return None

    def sonnet(self, system: str, prompt: str, max_tokens: int = 4096) -> Optional[str]:
        """Convenience method for Claude Sonnet (reasoning tier)."""
        return self.chat(
            self.sonnet_model, system,
            [{'role': 'user', 'content': prompt}],
            max_tokens
        )

    def opus(self, system: str, prompt: str, max_tokens: int = 8192) -> Optional[str]:
        """Convenience method for Claude Opus (deep analysis tier)."""
        return self.chat(
            self.opus_model, system,
            [{'role': 'user', 'content': prompt}],
            max_tokens
        )

    def get_usage(self) -> Dict:
        return self.usage
