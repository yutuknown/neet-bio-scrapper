from __future__ import annotations

import argparse
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from build_reports import build_reports
from scan_explanation_accuracy import run_scan as scan_explanation_accuracy
from scan_option_anomalies import scan_all as scan_option_anomalies
from score_chapter import score_chapter
from subject_sources import audit_targets

ROOT = Path(__file__).resolve().parent.parent
REPORT_ROOT = ROOT / "audit" / "reports"


def parse_csv_set(value: str | None) -> set[str] | None:
    if not value:
        return None
    parts = {item.strip().lower() for item in value.split(",") if item.strip()}
    return parts or None


def parse_class_set(value: str | None) -> set[str] | None:
    if not value:
        return None
    parts = {item.strip().upper() for item in value.split(",") if item.strip()}
    return parts or None


def run_subject_audit(
    subjects: set[str] | None = None,
    classes: set[str] | None = None,
    report_subdir: str = "global",
) -> list[dict]:
    chapter_results = []
    uncovered_chapters = []

    targets = audit_targets(subjects=subjects, selected_classes=classes)
    for target in targets:
        if not target.get("covered") or not target.get("source_url"):
            uncovered_chapters.append(
                {
                    "subject": target.get("subject", ""),
                    "class_code": target["class_code"],
                    "chapter": target["chapter_title"],
                    "slug": target["slug"],
                    "json_path": str(target["json_path"]),
                    "question_count": target["question_count"],
                    "coverage_reason": target.get("coverage_reason") or "missing_source",
                }
            )
            continue

        result = score_chapter(target["source_url"], str(target["json_path"]))
        result["subject"] = target.get("subject", "")
        result["class_code"] = target["class_code"]
        result["chapter"] = target["chapter_title"]
        result["slug"] = target["slug"]
        result["source_url"] = target["source_url"]
        chapter_results.append(result)

    report_dir = REPORT_ROOT / report_subdir
    option_anomalies = scan_option_anomalies(targets)
    explanation_results = scan_explanation_accuracy(targets, output_path=report_dir / "explanation_accuracy_scan.json")
    build_reports(str(report_dir), chapter_results, option_anomalies, explanation_results, uncovered_chapters)
    return chapter_results


def main() -> None:
    parser = argparse.ArgumentParser(description="Run chapterwise audit with subject/class filters.")
    parser.add_argument("--subjects", type=str, default=None, help="Comma-separated subjects: biology,physics,chemistry")
    parser.add_argument("--classes", type=str, default=None, help="Comma-separated class codes: B11,B12,P11,P12,C11,C12")
    parser.add_argument("--report-subdir", type=str, default="global", help="Subdirectory under audit/reports")
    args = parser.parse_args()

    subjects = parse_csv_set(args.subjects)
    classes = parse_class_set(args.classes)
    results = run_subject_audit(subjects=subjects, classes=classes, report_subdir=args.report_subdir)
    for result in results:
        print(
            f"{result.get('subject', '')} {result['class_code']} {result['slug']}: "
            f"accuracy={result['final_accuracy']} risk={result['risk']} schema_gap={result['schema_gap_risk']}"
        )


if __name__ == "__main__":
    main()
