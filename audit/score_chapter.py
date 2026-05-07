from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from align_questions import align_questions, similarity
from detect_schema_gaps import detect_schema_gap
from extract_source_signals import summarize_source_signals
from schema import validate_chapter


def load_scraped_questions(path: str) -> list[dict[str, Any]]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def structural_score(scraped_questions: list[dict[str, Any]], schema_errors: list[dict[str, Any]]) -> float:
    if not scraped_questions:
        return 0.0
    penalty = min(1.0, len(schema_errors) / max(len(scraped_questions), 1))
    return round(max(0.0, 1.0 - penalty), 4)


def completeness_score(signals: dict[str, Any], scraped_questions: list[dict[str, Any]]) -> float:
    expected_questions = max(signals.get("expected_question_count", 0), 1)
    expected_answers = max(signals.get("expected_answer_markers", 0), 1)
    expected_options = max(signals.get("expected_option_markers", 0), 1)
    expected_images = max(signals.get("expected_images", 0), 1)
    expected_tables = max(signals.get("expected_tables", 0), 1)

    scraped_answers = sum(1 for q in scraped_questions if q.get("answer"))
    scraped_options = sum(sum(1 for v in q.get("options", {}).values() if v) for q in scraped_questions)
    scraped_images = sum(len(q.get("images", [])) for q in scraped_questions)
    scraped_tables = sum(len(q.get("tables", [])) for q in scraped_questions)

    q_score = min(len(scraped_questions) / expected_questions, 1.0)
    a_score = min(scraped_answers / expected_answers, 1.0)
    o_score = min(scraped_options / expected_options, 1.0)
    i_score = min(scraped_images / expected_images, 1.0)
    t_score = min(scraped_tables / expected_tables, 1.0)

    return round(0.35 * q_score + 0.2 * a_score + 0.2 * o_score + 0.15 * i_score + 0.1 * t_score, 4)


def semantic_score(signals: dict[str, Any], scraped_questions: list[dict[str, Any]]) -> tuple[float, list[dict[str, Any]]]:
    alignments = align_questions(signals.get("blocks", []), scraped_questions)
    scores: list[float] = []

    for alignment in alignments:
        scores.append(alignment["score"] if alignment.get("matched") else 0.0)

    return round(average(scores), 4), alignments


def anomaly_score(scraped_questions: list[dict[str, Any]], gap: dict[str, Any]) -> float:
    if not scraped_questions:
        return 1.0
    empty_explanation_rate = sum(1 for q in scraped_questions if not q.get("explanation", {}).get("correct")) / len(scraped_questions)
    image_density = sum(len(q.get("images", [])) for q in scraped_questions) / len(scraped_questions)
    duplicate_option_rate = sum(1 for q in scraped_questions if len(set(q.get("options", {}).values())) < 4) / len(scraped_questions)
    raw = 0.4 * gap["schema_gap_risk"] + 0.25 * empty_explanation_rate + 0.2 * duplicate_option_rate + 0.15 * (1.0 if image_density > 2.5 else 0.0)
    return round(min(1.0, raw), 4)


def score_chapter(html_path: str, json_path: str) -> dict[str, Any]:
    signals = summarize_source_signals(html_path)
    scraped_questions = load_scraped_questions(json_path)
    schema_errors = validate_chapter(scraped_questions)
    gap = detect_schema_gap(signals, scraped_questions)

    structural = structural_score(scraped_questions, schema_errors)
    completeness = completeness_score(signals, scraped_questions)
    semantic, alignments = semantic_score(signals, scraped_questions)
    anomaly = anomaly_score(scraped_questions, gap)
    final_accuracy = round(0.25 * structural + 0.35 * completeness + 0.4 * semantic, 4)

    if anomaly >= 0.6 or gap["schema_gap_risk"] >= 0.5:
        risk = "high"
    elif anomaly >= 0.3 or final_accuracy < 0.75:
        risk = "medium"
    else:
        risk = "low"

    return {
        "html_path": html_path,
        "json_path": json_path,
        "expected_question_count": signals.get("expected_question_count", 0),
        "scraped_question_count": len(scraped_questions),
        "schema_error_count": len(schema_errors),
        "structural_accuracy": structural,
        "completeness_accuracy": completeness,
        "semantic_accuracy": semantic,
        "schema_gap_risk": gap["schema_gap_risk"],
        "anomaly_score": anomaly,
        "final_accuracy": final_accuracy,
        "risk": risk,
        "schema_errors": schema_errors,
        "alignments": alignments,
        "gap": gap,
    }
