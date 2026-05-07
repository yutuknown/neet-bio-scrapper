from __future__ import annotations

from typing import Any


def detect_schema_gap(signals: dict[str, Any], scraped_questions: list[dict[str, Any]]) -> dict[str, Any]:
    expected_questions = signals.get("expected_question_count", 0)
    scraped_count = len(scraped_questions)
    residual_blocks = signals.get("residual_block_count", 0)
    missing_question_ratio = max(expected_questions - scraped_count, 0) / max(expected_questions, 1)
    residual_ratio = residual_blocks / max(expected_questions, 1)

    return {
        "expected_question_count": expected_questions,
        "scraped_question_count": scraped_count,
        "missing_question_ratio": round(missing_question_ratio, 4),
        "residual_block_ratio": round(residual_ratio, 4),
        "schema_gap_risk": round(min(1.0, 0.7 * missing_question_ratio + 0.3 * residual_ratio), 4),
    }
