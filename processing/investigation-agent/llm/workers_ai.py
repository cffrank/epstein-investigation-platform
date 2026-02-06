"""Cloudflare Workers AI client via the existing CF Worker HTTP endpoint."""

import time
import logging
from typing import Optional, Dict

import requests

from config import WORKERS_AI_URL, WORKERS_AI_API_KEY, WORKERS_AI_MODEL

logger = logging.getLogger(__name__)


class WorkersAIClient:
    def __init__(self):
        self.url = WORKERS_AI_URL.rstrip('/')
        self.api_key = WORKERS_AI_API_KEY
        self.default_model = WORKERS_AI_MODEL
        self.total_calls = 0
        self.total_tokens = 0
        # Simple rate limiter: track last request time
        self._last_request = 0
        self._min_interval = 0.1  # 100ms between requests

    def generate(self, prompt: str, system: str = None, max_tokens: int = 2048,
                 model: str = None) -> Optional[str]:
        """Generate text using Workers AI via CF Worker endpoint."""
        # Rate limit
        now = time.time()
        elapsed = now - self._last_request
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request = time.time()

        payload = {
            'prompt': prompt,
            'max_tokens': max_tokens,
            'model': model or self.default_model,
        }
        if system:
            payload['system'] = system

        try:
            response = requests.post(
                f"{self.url}/ai/generate",
                headers={
                    'Content-Type': 'application/json',
                    'X-API-Key': self.api_key,
                },
                json=payload,
                timeout=60
            )

            if response.status_code == 429:
                logger.warning("Workers AI rate limited, waiting 5s...")
                time.sleep(5)
                return None

            if response.status_code != 200:
                logger.error(f"Workers AI error {response.status_code}: {response.text[:200]}")
                return None

            result = response.json()
            self.total_calls += 1
            text = result.get('text', '')
            self.total_tokens += len(text.split())  # rough estimate
            return text

        except requests.exceptions.Timeout:
            logger.error("Workers AI timeout")
            return None
        except Exception as e:
            logger.error(f"Workers AI error: {e}")
            return None

    def batch_summarize(self, texts: list, system_prompt: str) -> list:
        """Summarize multiple texts sequentially via Workers AI."""
        results = []
        for i, text in enumerate(texts):
            result = self.generate(
                prompt=text[:4000],
                system=system_prompt,
                max_tokens=512
            )
            results.append(result or f"[Failed to summarize document {i+1}]")
        return results

    def get_usage(self) -> Dict:
        return {'calls': self.total_calls, 'tokens': self.total_tokens}
