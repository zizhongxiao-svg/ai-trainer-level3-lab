from __future__ import annotations
"""Optional AI grading hook.

The public Community Edition ships without a bundled AI grader or external
worker configuration. Projects that need automatic free-text grading can wire
their own implementation here, using environment variables for credentials.
"""

from dataclasses import dataclass
from typing import Any

from app.edition import AIGradingDisabled


@dataclass
class AIGradeResult:
    score: float
    max_score: float
    rubric_scores: list[dict[str, Any]]
    feedback: dict[str, Any]
    raw_output: str
    model: str
    reasoning_effort: str


def grading_model() -> str:
    return "disabled"


def grading_reasoning_effort() -> str:
    return "disabled"


def build_doc_grading_prompt(*, exam_session_id: int, operation: dict, answers: dict) -> str:
    raise AIGradingDisabled("AI grading is not bundled in Community Edition")


def grade_doc_answer_with_ai(*, exam_session_id: int, operation: dict, answers: dict) -> AIGradeResult:
    raise AIGradingDisabled("AI grading is not bundled in Community Edition")
