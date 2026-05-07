from __future__ import annotations

import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from build_reports import build_reports
from score_chapter import score_chapter
from scan_option_anomalies import scan_all as scan_option_anomalies
from scan_explanation_accuracy import run_scan as scan_explanation_accuracy

ROOT = Path(__file__).resolve().parent.parent
REPORT_DIR = ROOT / "audit" / "reports"

BENCHMARKS = [
    {
        "html": ROOT / "fixtures" / "edurev" / "NEET-Previous-Year-Questions-2016-22-Principles-o.html",
        "json": ROOT / "data" / "raw" / "BIOLOGY" / "chapters" / "principles-of-inheritance-and-variation.json",
    },
    {
        "html": ROOT / "fixtures" / "edurev" / "NEET-Previous-Year-Questions-2016-20-Sexual-Repr.html",
        "json": ROOT / "data" / "raw" / "BIOLOGY" / "chapters" / "sexual-reproduction-in-flowering-plants.json",
    },
]


def run_audit() -> list[dict]:
    chapter_results = []
    for benchmark in BENCHMARKS:
        result = score_chapter(str(benchmark["html"]), str(benchmark["json"]))
        chapter_results.append(result)

    option_anomalies = scan_option_anomalies()
    build_reports(str(REPORT_DIR), chapter_results, option_anomalies)
    scan_explanation_accuracy()
    return chapter_results


if __name__ == "__main__":
    results = run_audit()
    for result in results:
        print(
            f"{Path(result['json_path']).name}: accuracy={result['final_accuracy']} risk={result['risk']} "
            f"schema_gap={result['schema_gap_risk']}"
        )
