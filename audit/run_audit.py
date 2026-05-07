from __future__ import annotations

import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from biology_sources import biology_audit_targets
from build_reports import build_reports
from score_chapter import score_chapter
from scan_option_anomalies import scan_all as scan_option_anomalies
from scan_explanation_accuracy import run_scan as scan_explanation_accuracy

ROOT = Path(__file__).resolve().parent.parent
REPORT_DIR = ROOT / "audit" / "reports"


def run_audit() -> list[dict]:
    chapter_results = []
    uncovered_chapters = []
    targets = biology_audit_targets()

    for target in targets:
        if not target.get("covered") or not target.get("source_url"):
            uncovered_chapters.append(
                {
                    "subject": "biology",
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
        result["subject"] = "biology"
        result["class_code"] = target["class_code"]
        result["chapter"] = target["chapter_title"]
        result["slug"] = target["slug"]
        result["source_url"] = target["source_url"]
        chapter_results.append(result)

    option_anomalies = scan_option_anomalies(targets)
    explanation_results = scan_explanation_accuracy(targets, output_path=REPORT_DIR / "explanation_accuracy_scan.json")
    build_reports(str(REPORT_DIR), chapter_results, option_anomalies, explanation_results, uncovered_chapters)
    return chapter_results


if __name__ == "__main__":
    results = run_audit()
    for result in results:
        print(
            f"{result['class_code']} {result['slug']}: accuracy={result['final_accuracy']} risk={result['risk']} "
            f"schema_gap={result['schema_gap_risk']}"
        )
