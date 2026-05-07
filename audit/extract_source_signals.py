from __future__ import annotations

import re
import ssl
import urllib.request
from pathlib import Path
from typing import Any

QUESTION_START_RE = re.compile(r"^Q\d+[:\s.]", re.I)
YEAR_RE = re.compile(r"\b(20\d{2})\b")
ANSWER_RE = re.compile(r"Ans[:\s-]+", re.I)
OPTION_RE = re.compile(r"^\([a-d]\)\s*", re.I)


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def load_html(source: str) -> str:
    if str(source).startswith(("http://", "https://")):
        request = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=120, context=ssl.create_default_context()) as response:
            return response.read().decode("utf-8", "replace")
    return Path(source).read_text(encoding="utf-8")


def extract_blocks_from_html(html_text: str) -> list[dict[str, Any]]:
    chunks = re.split(r"<[^>]+>", html_text)
    lines = [clean(chunk) for chunk in chunks]
    lines = [line for line in lines if line]

    current_year = ""
    blocks: list[dict[str, Any]] = []
    current_block: dict[str, Any] | None = None

    for line in lines:
        year_match = YEAR_RE.search(line)
        if year_match and len(line) < 20:
            current_year = year_match.group(1)
            continue

        if QUESTION_START_RE.match(line):
            if current_block:
                blocks.append(current_block)
            current_block = {"year": current_year, "lines": [line]}
            continue

        if current_block:
            current_block["lines"].append(line)

    if current_block:
        blocks.append(current_block)

    return blocks


def summarize_source_signals(html_path: str) -> dict[str, Any]:
    html_text = load_html(html_path)
    blocks = extract_blocks_from_html(html_text)

    answer_markers = 0
    option_markers = 0
    image_markers = html_text.count("<img")
    table_markers = html_text.count("<table")
    residual_lines = 0

    for block in blocks:
        joined = "\n".join(block["lines"])
        if ANSWER_RE.search(joined):
            answer_markers += 1
        option_markers += len([line for line in block["lines"] if OPTION_RE.match(line)])
        if len(block["lines"]) < 3:
            residual_lines += 1

    return {
        "expected_question_count": len(blocks),
        "expected_answer_markers": answer_markers,
        "expected_option_markers": option_markers,
        "expected_images": image_markers,
        "expected_tables": table_markers,
        "residual_block_count": residual_lines,
        "blocks": blocks,
    }
