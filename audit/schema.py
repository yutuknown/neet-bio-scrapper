from __future__ import annotations

from typing import Any

REQUIRED_TOP_LEVEL_KEYS = {
    "id": str,
    "text": str,
    "options": dict,
    "answer": str,
    "explanation": dict,
    "year": str,
    "chapter": str,
    "class": str,
    "images": list,
    "tables": list,
}

OPTION_EXTRACTION_KEYS = {
    "source": str,
    "status": str,
    "imageTokenCount": int,
    "nonEmptyOptionCount": int,
}

REQUIRED_OPTION_KEYS = ["A", "B", "C", "D"]
REQUIRED_EXPLANATION_KEYS = ["correct", "others"]


def validate_question(question: dict[str, Any], index: int) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []

    for key, expected_type in REQUIRED_TOP_LEVEL_KEYS.items():
        if key not in question:
            errors.append({"index": index, "field": key, "type": "missing_key"})
            continue
        if not isinstance(question[key], expected_type):
            errors.append({
                "index": index,
                "field": key,
                "type": "wrong_type",
                "expected": expected_type.__name__,
                "actual": type(question[key]).__name__,
            })

    options = question.get("options", {})
    if isinstance(options, dict):
        for key in REQUIRED_OPTION_KEYS:
            if key not in options:
                errors.append({"index": index, "field": f"options.{key}", "type": "missing_option"})
            elif not isinstance(options[key], str):
                errors.append({"index": index, "field": f"options.{key}", "type": "wrong_option_type"})

    explanation = question.get("explanation", {})
    if isinstance(explanation, dict):
        for key in REQUIRED_EXPLANATION_KEYS:
            if key not in explanation:
                errors.append({"index": index, "field": f"explanation.{key}", "type": "missing_explanation_key"})
            elif not isinstance(explanation[key], str):
                errors.append({"index": index, "field": f"explanation.{key}", "type": "wrong_explanation_type"})

    option_extraction = question.get("optionExtraction")
    if option_extraction is not None:
        if not isinstance(option_extraction, dict):
            errors.append({"index": index, "field": "optionExtraction", "type": "wrong_type", "expected": "dict", "actual": type(option_extraction).__name__})
        else:
            for key, expected_type in OPTION_EXTRACTION_KEYS.items():
                if key not in option_extraction:
                    errors.append({"index": index, "field": f"optionExtraction.{key}", "type": "missing_key"})
                elif not isinstance(option_extraction[key], expected_type):
                    errors.append({
                        "index": index,
                        "field": f"optionExtraction.{key}",
                        "type": "wrong_type",
                        "expected": expected_type.__name__,
                        "actual": type(option_extraction[key]).__name__,
                    })

    parser_warnings = question.get("parserWarnings")
    if parser_warnings is not None:
        if not isinstance(parser_warnings, list):
            errors.append({"index": index, "field": "parserWarnings", "type": "wrong_type", "expected": "list", "actual": type(parser_warnings).__name__})
        elif any(not isinstance(item, str) for item in parser_warnings):
            errors.append({"index": index, "field": "parserWarnings[]", "type": "wrong_warning_type"})

    return errors


def validate_chapter(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(questions, list):
        return [{"index": None, "field": "root", "type": "root_not_list"}]

    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            errors.append({"index": index, "field": "root[]", "type": "question_not_object"})
            continue
        errors.extend(validate_question(question, index))

    return errors
