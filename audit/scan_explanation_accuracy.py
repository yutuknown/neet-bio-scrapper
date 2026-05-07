from __future__ import annotations

import html
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent
ROOT = CURRENT_DIR.parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from align_questions import align_questions, similarity
from extract_source_signals import extract_blocks_from_html

PYQ_INDEX = json.loads((ROOT / "data" / "raw" / "pyq-links.json").read_text(encoding="utf-8"))
CHAPTER_DIR = ROOT / "data" / "raw" / "BIOLOGY" / "chapters"
OUTPUT_PATH = ROOT / ".debug" / "explanation_accuracy_scan.json"

UI_PATTERN = re.compile(r"Type\s*Your\s*Answer|View\s*Answer|Solution:?", re.I)
ANS_MARKER_RE = re.compile(r"\bA\s*n\s*s\b\s*[:.-]?\s*", re.I)
LEADING_ANSWER_RE = re.compile(r"^(?:Ans[:\s-]+)?[\s(]*[a-d](?:[)\s.:,-]|$)\s*", re.I)
INLINE_ANSWER_RE = re.compile(r"\bAns\b\s*[:.-]?\s*[\s(]*[a-d][)\s.:,-]*", re.I)
QUESTION_NUM_RE = re.compile(r"^Q(\d+)[:\s.]", re.I)
ZERO_WIDTH_RE = re.compile(r"[​-‍﻿]")


def clean(text: str) -> str:
    value = html.unescape(str(text or ""))
    return ZERO_WIDTH_RE.sub("", value).replace("\xa0", " ")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", clean(text)).strip().lower()


def truncate(text: str, limit: int = 160) -> str:
    value = clean(text).strip()
    return value if len(value) <= limit else f"{value[:limit]}…"


def fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=120, context=ssl.create_default_context()) as response:
        return response.read().decode("utf-8", "replace")


def source_question_number(lines: list[str]) -> int | None:
    for line in lines:
        match = QUESTION_NUM_RE.match(clean(line))
        if match:
            return int(match.group(1))
    return None


def source_explanation(lines: list[str]) -> str:
    text = clean(" ".join(clean(line) for line in lines if clean(line)))
    if not text:
        return ""

    marker = ANS_MARKER_RE.search(text)
    if not marker:
        return ""

    explanation = clean(text[marker.end() :])
    explanation = LEADING_ANSWER_RE.sub("", explanation, count=1)
    explanation = INLINE_ANSWER_RE.sub("", explanation, count=1)
    return re.sub(r"\s+", " ", explanation).strip()


def json_explanation(question: dict[str, Any]) -> str:
    value = question.get("explanation", "")
    if isinstance(value, dict):
        value = value.get("correct", "") or value.get("others", "") or ""
    text = clean(value).strip()
    if text.startswith("{'correct':") or text.startswith('{"correct":'):
        try:
            parsed = json.loads(text.replace("'", '"'))
            if isinstance(parsed, dict):
                text = parsed.get("correct", "") or parsed.get("others", "") or text
        except Exception:
            pass
    return re.sub(r"\s+", " ", text).strip()


def ui_leak(text: str) -> bool:
    return bool(UI_PATTERN.search(text))


def explanation_similarity(left: str, right: str) -> float:
    left_norm = normalize(left)
    right_norm = normalize(right)
    if left_norm == right_norm:
        return 1.0
    if left_norm and right_norm and (left_norm in right_norm or right_norm in left_norm):
        return 0.98
    return similarity(left_norm, right_norm)


def run_scan() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    for chapter_entry in PYQ_INDEX["chapters"]:
        chapter = chapter_entry["chapter"]
        title = chapter["title"]
        slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9\s-]", "", title.replace("&", " and ").strip().lower().replace(" ", "-")))
        json_path = CHAPTER_DIR / f"{slug}.json"
        if not json_path.exists():
            continue

        pyq = chapter_entry["pyqLinks"][0]
        url = pyq.get("canonicalUrl") or pyq.get("url")
        html = fetch_html(url)
        source_blocks = extract_blocks_from_html(html)
        scraped_questions = json.loads(json_path.read_text(encoding="utf-8"))
        alignments = align_questions(source_blocks, scraped_questions)

        categories: dict[str, list[dict[str, Any]]] = {
            "missing_explanation_from_source": [],
            "missing_explanation_in_json": [],
            "explanation_mismatch": [],
            "ui_text_leaked": [],
        }

        for row in alignments:
            if not row.get("matched"):
                continue

            source = source_blocks[row["source_index"]]
            question = scraped_questions[row["scraped_index"]]
            source_text = source_explanation(source.get("lines", []))
            json_text = json_explanation(question)
            meta = {
                "jsonId": question.get("id"),
                "sourceQ": f"Q{source_question_number(source.get('lines', []))}" if source_question_number(source.get("lines", [])) else None,
                "year": question.get("year"),
                "text": truncate(question.get("text", "")),
            }

            if source_text and not json_text:
                categories["missing_explanation_in_json"].append({**meta, "sourceSnippet": truncate(source_text)})
            if json_text and not source_text:
                categories["missing_explanation_from_source"].append({**meta, "jsonSnippet": truncate(json_text)})
            if source_text and json_text:
                score = explanation_similarity(source_text, json_text)
                if score < 0.32:
                    categories["explanation_mismatch"].append(
                        {
                            **meta,
                            "similarity": round(score, 3),
                            "sourceSnippet": truncate(source_text),
                            "jsonSnippet": truncate(json_text),
                        }
                    )
            if ui_leak(json_text):
                categories["ui_text_leaked"].append({**meta})

        counts = {key: len(value) for key, value in categories.items()}
        results.append(
            {
                "chapter": title,
                "slug": slug,
                "sourceUrl": url,
                "sourceQuestionCount": len(source_blocks),
                "jsonQuestionCount": len(scraped_questions),
                "counts": counts,
                "categories": categories,
            }
        )

    OUTPUT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


if __name__ == "__main__":
    results = run_scan()
    print(f"wrote={OUTPUT_PATH}")
    for row in sorted(
        ({"chapter": result["chapter"], "total": sum(result["counts"].values()), **result["counts"]} for result in results),
        key=lambda row: (-row["total"], row["chapter"]),
    ):
        print(
            f"{row['chapter']} | total={row['total']} | missFromSource={row['missing_explanation_from_source']} "
            f"missInJson={row['missing_explanation_in_json']} mismatch={row['explanation_mismatch']} uiLeak={row['ui_text_leaked']}"
        )
