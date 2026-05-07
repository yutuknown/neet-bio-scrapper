from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def write_json(path: str, data: Any) -> None:
    Path(path).write_text(json.dumps(data, indent=2), encoding="utf-8")


def write_csv(path: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        Path(path).write_text("", encoding="utf-8")
        return

    fieldnames = list(rows[0].keys())
    with Path(path).open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def dominant_failures(result: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    gap = result.get("gap", {})
    if result.get("schema_error_count", 0) > 0:
        failures.append("schema_errors")
    if gap.get("missing_question_ratio", 0) > 0:
        failures.append("missing_questions")
    if gap.get("residual_block_ratio", 0) > 0.1:
        failures.append("alignment_residuals")
    if result.get("completeness_accuracy", 1) < 0.95:
        failures.append("completeness_drop")
    if result.get("semantic_accuracy", 1) < 0.95:
        failures.append("semantic_mismatch")
    if result.get("anomaly_score", 0) >= 0.3:
        failures.append("content_anomalies")
    return failures


def build_reports(
    report_dir: str,
    chapter_results: list[dict[str, Any]],
    option_anomalies: dict[str, Any] | None = None,
    explanation_results: list[dict[str, Any]] | None = None,
    uncovered_chapters: list[dict[str, Any]] | None = None,
) -> None:
    report_path = Path(report_dir)
    report_path.mkdir(parents=True, exist_ok=True)

    chapter_summary = [
        {
            "subject": result.get("subject", ""),
            "class_code": result.get("class_code", ""),
            "chapter": result.get("chapter", ""),
            "slug": result.get("slug", Path(result["json_path"]).stem),
            "source_url": result.get("source_url", result.get("html_path", "")),
            "html_path": result["html_path"],
            "json_path": result["json_path"],
            "expected_question_count": result["expected_question_count"],
            "scraped_question_count": result["scraped_question_count"],
            "schema_error_count": result["schema_error_count"],
            "structural_accuracy": result["structural_accuracy"],
            "completeness_accuracy": result["completeness_accuracy"],
            "semantic_accuracy": result["semantic_accuracy"],
            "schema_gap_risk": result["schema_gap_risk"],
            "anomaly_score": result["anomaly_score"],
            "final_accuracy": result["final_accuracy"],
            "risk": result["risk"],
            "dominant_failures": dominant_failures(result),
        }
        for result in chapter_results
    ]

    high_risk = [row for row in chapter_summary if row["risk"] != "low"]
    schema_failures = [
        {
            "subject": result.get("subject", ""),
            "class_code": result.get("class_code", ""),
            "chapter": result.get("chapter", ""),
            "slug": result.get("slug", Path(result["json_path"]).stem),
            "json_path": result["json_path"],
            "errors": result["schema_errors"],
        }
        for result in chapter_results if result["schema_errors"]
    ]
    residuals = [
        {
            "subject": result.get("subject", ""),
            "class_code": result.get("class_code", ""),
            "chapter": result.get("chapter", ""),
            "slug": result.get("slug", Path(result["json_path"]).stem),
            "json_path": result["json_path"],
            "missing_question_ratio": result["gap"]["missing_question_ratio"],
            "residual_block_ratio": result["gap"]["residual_block_ratio"],
            "schema_gap_risk": result["gap"]["schema_gap_risk"],
        }
        for result in chapter_results
    ]
    alignments = [
        {
            "subject": result.get("subject", ""),
            "class_code": result.get("class_code", ""),
            "chapter": result.get("chapter", ""),
            "slug": result.get("slug", Path(result["json_path"]).stem),
            "json_path": result["json_path"],
            "alignments": result["alignments"],
        }
        for result in chapter_results
    ]

    write_csv(str(report_path / "chapter_summary.csv"), chapter_summary)
    write_json(str(report_path / "chapter_summary.json"), chapter_summary)
    write_json(str(report_path / "high_risk_chapters.json"), high_risk)
    write_json(str(report_path / "schema_failures.json"), schema_failures)
    write_json(str(report_path / "residual_text_report.json"), residuals)
    write_json(str(report_path / "question_alignment.json"), alignments)
    write_json(str(report_path / "uncovered_chapters.json"), uncovered_chapters or [])
    if option_anomalies is not None:
        write_json(str(report_path / "option_anomalies.json"), option_anomalies)
    if explanation_results is not None:
        write_json(str(report_path / "explanation_accuracy_scan.json"), explanation_results)
