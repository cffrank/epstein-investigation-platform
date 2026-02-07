"""Main execution loop for investigations."""

import logging
import traceback
from typing import Optional, Dict

from engine.state import Investigation, Step, DecisionPoint
from engine.findings import FindingManager
from engine.reports import generate_markdown_report, save_report
from db.unified import UnifiedSearch
from llm.router import LLMRouter

logger = logging.getLogger(__name__)


class Executor:
    def __init__(self, investigation: Investigation, unified: UnifiedSearch,
                 llm: LLMRouter, findings: FindingManager):
        self.inv = investigation
        self.unified = unified
        self.llm = llm
        self.findings = findings
        # Accumulated data from steps, available to subsequent steps
        self.context = dict(self.inv.state)

    def run(self, decision_callback=None):
        """Execute investigation steps. Pauses at decision points.

        decision_callback: callable that receives a DecisionPoint and returns
        the user's choice as a string. If None, investigation pauses at
        decision points and must be resumed.
        """
        self.inv.set_status('executing')
        steps = self.inv.steps
        start_index = self.inv.current_step_index()

        logger.info(f"Executing from step {start_index + 1}/{len(steps)}")

        for i in range(start_index, len(steps)):
            step = steps[i]
            logger.info(f"Step {i + 1}/{len(steps)}: {step.name} [{step.tier}]")

            self.inv.update_step(i, status='running')

            try:
                result = self._execute_step(step)
                self.inv.update_step(i, status='completed', result=result)
                self.context[f'step_{i}_result'] = result

                # Save context to state for crash recovery
                self.inv.save_state(self.context)

                # Update model usage
                self.inv.update_model_usage(self.llm.get_usage())

                # Check if playbook wants a decision point after this step
                if isinstance(result, dict) and result.get('decision_required'):
                    dp = DecisionPoint(
                        message=result.get('decision_message', 'Decision required'),
                        options=result.get('decision_options', []),
                        step_index=i,
                    )
                    self.inv.add_decision_point(dp)

                    if decision_callback:
                        choice = decision_callback(dp)
                        self.inv.resolve_decision(choice)
                        self.context['last_decision'] = choice
                    else:
                        logger.info("Investigation paused for decision")
                        return {'status': 'awaiting_decision', 'step': i, 'decision': dp.to_dict()}

            except Exception as e:
                error_msg = f"{e}\n{traceback.format_exc()}"
                logger.error(f"Step {i + 1} failed: {error_msg}")
                self.inv.update_step(i, status='failed', error=str(e))
                # Continue to next step rather than stopping
                continue

        # All steps completed
        self.inv.update_model_usage(self.llm.get_usage())
        self.inv.complete()
        logger.info("Investigation completed")
        return {'status': 'completed'}

    def _execute_step(self, step: Step) -> Optional[Dict]:
        """Execute a single step based on its action type."""
        action = step.action
        ctx = self.context

        # Database query actions
        if action == 'search_person':
            name = ctx.get('target_name', self.inv.target.get('name', ''))
            return self.unified.search_person(name)

        elif action == 'search_fulltext':
            query = ctx.get('search_query', self.inv.target.get('query', ''))
            return {'documents': self.unified.pg.search_fulltext(query, 100)}

        elif action == 'get_entity_network':
            name = ctx.get('target_name', self.inv.target.get('name', ''))
            return self.unified.get_entity_network(name)

        elif action == 'find_connections':
            a = self.inv.target.get('entity_a', '')
            b = self.inv.target.get('entity_b', '')
            return self.unified.find_connections(a, b)

        elif action == 'search_documents_topic':
            query = ctx.get('search_query', self.inv.target.get('query', ''))
            return self.unified.search_documents(query)

        elif action == 'search_vlm':
            query = ctx.get('search_query', self.inv.target.get('query', self.inv.target.get('name', '')))
            return {'vlm_documents': self.unified.pg.search_vlm_results(query, 50)}

        elif action == 'get_co_mentioned':
            name = ctx.get('target_name', self.inv.target.get('name', ''))
            return {'co_mentioned': self.unified.neo4j.co_mentioned_entities(name)}

        elif action == 'get_hub_entities':
            entity_type = ctx.get('entity_type', 'Person')
            return {'hubs': self.unified.neo4j.find_hub_entities(entity_type)}

        elif action == 'get_investigation_notes':
            subject = ctx.get('target_name', self.inv.target.get('name', ''))
            return {'notes': self.unified.pg.get_investigation_notes(subject)}

        elif action == 'get_metadata_stats':
            field = ctx.get('metadata_field', 'source')
            return {'stats': self.unified.pg.get_metadata_stats(field)}

        # LLM actions
        elif action == 'bulk_summarize':
            docs = self._get_docs_from_context()
            texts = [d.get('text_preview', d.get('metadata', {}).get('text', '')[:500])
                     for d in docs[:50]]
            system = step.description or "Summarize this document concisely."
            summaries = self.llm.workers.batch_summarize(texts, system)
            return {'summaries': summaries, 'count': len(summaries)}

        elif action == 'classify_relevance':
            docs = self._get_docs_from_context()
            topic = ctx.get('search_query', self.inv.target.get('query', ''))
            classified = []
            for doc in docs[:30]:
                text = doc.get('text_preview', '')[:500]
                result = self.llm.bulk(
                    "Rate document relevance 1-10 and explain briefly.",
                    f"Topic: {topic}\n\nDocument: {text}\n\nFormat: SCORE: [N] | REASON: [text]"
                )
                classified.append({'doc': doc, 'classification': result})
            return {'classified': classified}

        elif action == 'analyze_patterns':
            summaries = ctx.get(f'step_{self._prev_step_index()}_result', {}).get('summaries', [])
            topic = ctx.get('search_query', self.inv.target.get('name', ''))
            summaries_text = '\n\n'.join(f"Doc {i+1}: {s}" for i, s in enumerate(summaries[:30]))
            result = self.llm.reason(
                "You are an investigative analyst. Identify patterns across documents.",
                f"Analyze these {len(summaries)} document summaries about \"{topic}\":\n\n{summaries_text}\n\n"
                "Identify: 1) Recurring patterns 2) Contradictions 3) Key claims with multiple sources 4) Evidence gaps"
            )
            return {'analysis': result}

        elif action == 'analyze_connections':
            prev = ctx.get(f'step_{self._prev_step_index()}_result', {})
            connections = prev.get('connections', prev.get('co_mentioned', []))
            name = ctx.get('target_name', self.inv.target.get('name', ''))
            conn_text = '\n'.join(f"- {c.get('name', 'unknown')} ({c.get('type', '?')}): "
                                  f"{c.get('shared_docs', c.get('co_mentions', 0))} shared docs"
                                  for c in connections[:30])
            result = self.llm.reason(
                "You are an investigative analyst examining connections between entities.",
                f"Analyze connections for \"{name}\":\n\n{conn_text}\n\n"
                "Identify: 1) Strongest connections 2) Unexpected connections "
                "3) Clusters/groups 4) Key intermediaries"
            )
            return {'analysis': result}

        elif action == 'synthesize':
            findings_text = self.findings.summarize()
            name = self.inv.name
            target = self.inv.target
            result = self.llm.deep(
                "You are producing a final intelligence assessment.",
                f"Investigation: {name}\nTarget: {target}\n\nFindings:\n{findings_text}\n\n"
                "Produce:\n1. EXECUTIVE SUMMARY\n2. KEY FINDINGS (with confidence)\n"
                "3. EVIDENCE CHAIN\n4. GAPS AND LIMITATIONS\n5. RECOMMENDED NEXT STEPS"
            )
            return {'synthesis': result}

        elif action == 'generate_plan':
            question = self.inv.target.get('question', '')
            result = self.llm.deep(
                "You are an investigative planner with access to 1.3M+ documents.",
                f"Generate an investigation plan for: \"{question}\"\n\n"
                "Available: PostgreSQL full-text search, Qdrant semantic search, "
                "Neo4j entity graph (88K entities, 917K relationships)\n\n"
                "Return 5-10 numbered steps with ACTION, SOURCE, and PURPOSE for each."
            )
            return {'plan': result}

        # Decision point actions
        elif action == 'decision_continue':
            # This step generates a decision point based on accumulated data
            summary = self._build_progress_summary()
            return {
                'decision_required': True,
                'decision_message': summary,
                'decision_options': [
                    {'label': '1', 'description': 'Continue with deep analysis (Recommended)'},
                    {'label': '2', 'description': 'Focus on specific connection cluster'},
                    {'label': '3', 'description': 'Narrow to date range'},
                    {'label': '4', 'description': 'Skip to report with current findings'},
                ],
            }

        elif action == 'extract_findings':
            # Parse LLM analysis output and store as findings
            analysis = None
            for j in range(len(self.inv.steps) - 1, -1, -1):
                prev_result = ctx.get(f'step_{j}_result', {})
                if isinstance(prev_result, dict) and prev_result.get('analysis'):
                    analysis = prev_result['analysis']
                    break

            if analysis:
                self._extract_and_store_findings(analysis, step.tier)
            return {'findings_extracted': self.findings.count}

        else:
            logger.warning(f"Unknown action: {action}")
            return {'warning': f'Unknown action: {action}'}

    def _get_docs_from_context(self):
        """Extract document list from previous step results."""
        for j in range(len(self.inv.steps) - 1, -1, -1):
            result = self.context.get(f'step_{j}_result', {})
            if isinstance(result, dict):
                if 'documents' in result:
                    return result['documents']
                if 'merged' in result:
                    return result['merged']
        return []

    def _prev_step_index(self) -> int:
        """Get the index of the most recently completed step."""
        current = self.inv.current_step_index()
        return max(0, current - 1)

    def _build_progress_summary(self) -> str:
        """Build a summary of progress so far for decision points."""
        parts = []
        for j in range(len(self.inv.steps)):
            result = self.context.get(f'step_{j}_result', {})
            if not isinstance(result, dict):
                continue
            if 'document_count' in result:
                parts.append(f"Found {result['document_count']} documents")
            if 'connection_count' in result:
                parts.append(f"Found {result['connection_count']} connections")
            if 'summaries' in result:
                parts.append(f"Summarized {result.get('count', len(result['summaries']))} documents")

        parts.append(f"Findings so far: {self.findings.count}")
        return '\n'.join(parts)

    def _extract_and_store_findings(self, analysis: str, tier: str):
        """Parse analysis text and store individual findings."""
        # Simple heuristic: split on numbered items or bullet points
        lines = analysis.split('\n')
        current_finding = []
        for line in lines:
            stripped = line.strip()
            if stripped and (stripped[0].isdigit() or stripped.startswith('- ') or stripped.startswith('* ')):
                if current_finding:
                    self._store_parsed_finding(current_finding, tier)
                current_finding = [stripped]
            elif current_finding:
                current_finding.append(stripped)

        if current_finding:
            self._store_parsed_finding(current_finding, tier)

    def _store_parsed_finding(self, lines: list, tier: str):
        """Store a single parsed finding."""
        text = ' '.join(lines).strip()
        if len(text) < 20:
            return
        # Use first line as title, rest as description
        title = lines[0][:200].lstrip('0123456789.-*) ')
        description = text

        model = 'workers_ai' if tier == 'bulk' else 'sonnet' if tier == 'reasoning' else 'opus'
        self.findings.add(
            finding_type='pattern',
            title=title,
            description=description,
            confidence=0.5 if tier == 'bulk' else 0.7 if tier == 'reasoning' else 0.85,
            model_source=model,
        )
