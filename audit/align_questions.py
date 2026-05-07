from __future__ import annotations

import difflib
import re
from typing import Any

QUESTION_NUMBER_RE = re.compile(r"^Q(\d+)[:\s.]", re.I)


def normalize(text: str) -> str:
    text = text.replace("&", " and ")
    text = re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip().lower()
    return text


def similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    return difflib.SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def option_similarity(source_text: str, scraped_options: dict[str, str]) -> float:
    if not scraped_options:
        return 0.0
    score = 0.0
    for value in scraped_options.values():
        if value and normalize(value) in normalize(source_text):
            score += 1.0
    return score / max(len(scraped_options), 1)


def extract_question_number(lines: list[str]) -> int | None:
    for line in lines:
        match = QUESTION_NUMBER_RE.match(line)
        if match:
            return int(match.group(1))
    return None


def question_number(question: dict[str, Any]) -> int | None:
    value = question.get("sourceQuestionNumber")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def year_key(value: Any) -> str:
    return normalize(str(value or ""))


def align_questions(source_blocks: list[dict[str, Any]], scraped_questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    alignments: list[dict[str, Any]] = []
    used_scraped: set[int] = set()
    scraped_by_key: dict[tuple[str, int], list[int]] = {}

    for scraped_index, question in enumerate(scraped_questions):
        qnum = question_number(question)
        if qnum is None:
            continue
        key = (year_key(question.get("year", "")), qnum)
        scraped_by_key.setdefault(key, []).append(scraped_index)

    for source_index, block in enumerate(source_blocks):
        source_text = " ".join(block.get("lines", []))
        source_year = block.get("year", "")
        source_qnum = extract_question_number(block.get("lines", []))
        source_key = (year_key(source_year), source_qnum) if source_qnum is not None else None

        candidate_indexes: list[int] = []
        if source_key is not None:
            candidate_indexes = [idx for idx in scraped_by_key.get(source_key, []) if idx not in used_scraped]

        best: tuple[int, dict[str, Any]] | None = None
        best_score = -1.0
        if candidate_indexes:
            for scraped_index in candidate_indexes:
                question = scraped_questions[scraped_index]
                text_score = similarity(source_text, question.get("text", ""))
                options_score = option_similarity(source_text, question.get("options", {}))
                answer_score = 1.0 if question.get("answer") else 0.0
                total = 0.65 * text_score + 0.15 * options_score + 0.15 * answer_score + 0.05
                if total > best_score:
                    best_score = total
                    best = (scraped_index, question)
        else:
            for scraped_index, question in enumerate(scraped_questions):
                if scraped_index in used_scraped:
                    continue

                text_score = similarity(source_text, question.get("text", ""))
                year_score = 1.0 if source_year and question.get("year") == source_year else 0.0
                options_score = option_similarity(source_text, question.get("options", {}))
                answer_score = 1.0 if question.get("answer") else 0.0
                total = 0.5 * text_score + 0.15 * year_score + 0.2 * options_score + 0.15 * answer_score

                if total > best_score:
                    best_score = total
                    best = (scraped_index, question)

        if best is None:
            alignments.append({"source_index": source_index, "scraped_index": None, "score": 0.0, "matched": False, "source_year": source_year, "source_question_number": source_qnum})
            continue

        scraped_index, question = best
        used_scraped.add(scraped_index)
        alignments.append({
            "source_index": source_index,
            "scraped_index": scraped_index,
            "score": round(best_score, 4),
            "matched": best_score >= 0.55,
            "source_year": source_year,
            "source_question_number": source_qnum,
            "scraped_year": question.get("year", ""),
            "scraped_source_question_number": question_number(question),
            "scraped_id": question.get("id", ""),
        })

    return alignments
