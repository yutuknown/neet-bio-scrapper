from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CHAPTER_DIR = ROOT / "data" / "raw" / "BIOLOGY" / "chapters"
REPORT_DIR = ROOT / "audit" / "reports"

OPTION_LABELS = ["A", "B", "C", "D"]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def scan_question(chapter_slug: str, question: dict[str, Any]) -> dict[str, Any] | None:
    options = question.get("options", {}) if isinstance(question.get("options"), dict) else {}
    values = {label: str(options.get(label, "") or "").strip() for label in OPTION_LABELS}
    non_empty_option_count = sum(1 for value in values.values() if value)
    parser_warnings = question.get("parserWarnings") if isinstance(question.get("parserWarnings"), list) else []
    option_extraction = question.get("optionExtraction") if isinstance(question.get("optionExtraction"), dict) else {}

    anomaly_types: list[str] = []
    if non_empty_option_count == 0:
        anomaly_types.append("all_options_empty")
    elif non_empty_option_count < len(OPTION_LABELS):
        anomaly_types.append("partial_options")

    if question.get("answer") and non_empty_option_count < len(OPTION_LABELS):
        anomaly_types.append("answer_without_full_options")

    if question.get("images") and non_empty_option_count < len(OPTION_LABELS):
        anomaly_types.append("image_backed_option_gap")

    if parser_warnings:
        anomaly_types.append("parser_warning")

    if not anomaly_types:
        return None

    return {
        "chapter_slug": chapter_slug,
        "chapter": question.get("chapter", ""),
        "question_id": question.get("id", ""),
        "year": question.get("year", ""),
        "text": question.get("text", ""),
        "answer": question.get("answer", ""),
        "images": len(question.get("images", []) or []),
        "tables": len(question.get("tables", []) or []),
        "non_empty_option_count": non_empty_option_count,
        "option_extraction": option_extraction,
        "parser_warnings": parser_warnings,
        "anomaly_types": anomaly_types,
        "options": values,
    }


def scan_all() -> dict[str, Any]:
    chapters: list[dict[str, Any]] = []
    anomalies: list[dict[str, Any]] = []

    for path in sorted(CHAPTER_DIR.glob("*.json")):
        questions = load_json(path)
        chapter_slug = path.stem
        chapter_anomalies = [
            result
            for question in questions
            if isinstance(question, dict)
            for result in [scan_question(chapter_slug, question)]
            if result is not None
        ]
        anomalies.extend(chapter_anomalies)
        chapters.append(
            {
                "chapter_slug": chapter_slug,
                "question_count": len(questions),
                "anomaly_count": len(chapter_anomalies),
                "all_empty_option_count": sum("all_options_empty" in row["anomaly_types"] for row in chapter_anomalies),
                "partial_option_count": sum("partial_options" in row["anomaly_types"] for row in chapter_anomalies),
                "image_backed_gap_count": sum("image_backed_option_gap" in row["anomaly_types"] for row in chapter_anomalies),
            }
        )

    summary = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "chapter_count": len(chapters),
        "anomaly_count": len(anomalies),
        "all_empty_option_count": sum("all_options_empty" in row["anomaly_types"] for row in anomalies),
        "partial_option_count": sum("partial_options" in row["anomaly_types"] for row in anomalies),
        "image_backed_gap_count": sum("image_backed_option_gap" in row["anomaly_types"] for row in anomalies),
        "chapters": chapters,
        "questions": anomalies,
    }
    return summary


def main() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = scan_all()
    output_path = REPORT_DIR / "option_anomalies.json"
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Option anomaly report written to {output_path}")
    print(
        f"anomalies={report['anomaly_count']} all_empty={report['all_empty_option_count']} "
        f"partial={report['partial_option_count']} image_backed={report['image_backed_gap_count']}"
    )


if __name__ == "__main__":
    main()
