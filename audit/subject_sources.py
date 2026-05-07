from __future__ import annotations

import json
import re
import ssl
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RAW_ROOT = ROOT / "data" / "raw"
FAULT_REPORT_PATH = ROOT / ".debug" / "chapterwise_scraper_faults.json"
EDUREV_BASE_URL = "https://edurev.in"

COURSE_URLS = {
    "B11": "https://edurev.in/courses/1822_Biology-Class-11--Notes--Questions--Videos--MCQs",
    "B12": "https://edurev.in/courses/716_Biology-Class-12--Notes--Questions--Videos--MCQs",
    "P11": "https://edurev.in/courses/592_Physics-Class-11-Notes--Questions--Videos--MCQ",
    "P12": "https://edurev.in/courses/1643_Physics-Class-12",
    "C11": "https://edurev.in/courses/626_Chemistry-Class-11--Notes--Questions--Videos--MCQs",
    "C12": "https://edurev.in/courses/1548_Chemistry-Class-12",
}

CLASS_SUBJECT = {
    "B11": "biology",
    "B12": "biology",
    "P11": "physics",
    "P12": "physics",
    "C11": "chemistry",
    "C12": "chemistry",
}

CLASS_DATA_DIR = {
    "B11": RAW_ROOT / "BIOLOGY" / "B11" / "chapters",
    "B12": RAW_ROOT / "BIOLOGY" / "B12" / "chapters",
    "P11": RAW_ROOT / "PHYSICS" / "P11" / "chapters",
    "P12": RAW_ROOT / "PHYSICS" / "P12" / "chapters",
    "C11": RAW_ROOT / "CHEMISTRY" / "C11" / "chapters",
    "C12": RAW_ROOT / "CHEMISTRY" / "C12" / "chapters",
}


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").replace("\xa0", " ")).strip()


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9\s-]", "", clean(text).replace("&", " and ").lower().replace(" ", "-"))).strip("-")


def normalize_title(text: str) -> str:
    return clean(text).replace("&", " and ").replace("-", " ").lower()


def class_codes(subjects: set[str] | None = None, selected_classes: set[str] | None = None) -> list[str]:
    subjects_norm = {s.lower() for s in subjects} if subjects else None
    classes_norm = {c.upper() for c in selected_classes} if selected_classes else None

    rows: list[str] = []
    for code in COURSE_URLS:
        if classes_norm and code not in classes_norm:
            continue
        if subjects_norm and CLASS_SUBJECT[code] not in subjects_norm:
            continue
        rows.append(code)
    return rows


def load_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=120, context=ssl.create_default_context()) as response:
        return response.read().decode("utf-8", "replace")


def chapter_files(subjects: set[str] | None = None, selected_classes: set[str] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for code in class_codes(subjects, selected_classes):
        chapter_dir = CLASS_DATA_DIR[code]
        if not chapter_dir.exists():
            continue
        for path in sorted(chapter_dir.glob("*.json")):
            try:
                questions = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                questions = []
            chapter_title = ""
            if questions and isinstance(questions[0], dict):
                chapter_title = clean(questions[0].get("chapter", ""))
            rows.append(
                {
                    "subject": CLASS_SUBJECT[code],
                    "class_code": code,
                    "slug": path.stem,
                    "chapter_title": chapter_title or path.stem.replace("-", " ").title(),
                    "json_path": path,
                    "question_count": len(questions) if isinstance(questions, list) else 0,
                }
            )
    return rows


def b12_sources_from_fault_report() -> dict[tuple[str, str], dict[str, Any]]:
    if not FAULT_REPORT_PATH.exists():
        return {}
    rows = json.loads(FAULT_REPORT_PATH.read_text(encoding="utf-8"))
    mapping: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = row.get("slug") or slugify(row.get("chapter", ""))
        source_url = row.get("sourceUrl")
        if not slug or not source_url:
            continue
        mapping[("B12", slug)] = {
            "source_url": source_url,
            "source_label": row.get("chapter") or slug,
            "source_type": "remote_url",
        }
    return mapping


def course_chapters(class_code: str) -> list[dict[str, str]]:
    course_url = COURSE_URLS[class_code]
    html = load_html(course_url)
    pattern = re.compile(
        r"<a class=crs_chptr[^>]*href=/chapter/(\d+)_([^\s>]+)[^>]*>\s*<h2 class=subcoursetitle>(.*?)</h2>",
        re.I | re.S,
    )
    chapters: list[dict[str, str]] = []
    seen: set[str] = set()
    for chapter_id, href_slug, title in pattern.findall(html):
        cleaned_title = clean(re.sub(r"<[^>]+>", " ", title))
        slug = slugify(cleaned_title)
        if not cleaned_title or slug in seen:
            continue
        seen.add(slug)
        chapters.append(
            {
                "chapter_id": chapter_id,
                "href_slug": href_slug,
                "chapter_title": cleaned_title,
                "slug": slug,
                "chapter_url": f"{EDUREV_BASE_URL}/chapter/{chapter_id}_{href_slug}",
            }
        )
    return chapters


def extract_neet_doc(chapter_html: str, chapter_title: str) -> dict[str, str] | None:
    normalized_chapter = normalize_title(chapter_title)
    candidates: list[dict[str, str]] = []

    jsonld_pattern = re.compile(
        r'"name":"([^"]*NEET Previous Year Questions[^"]*)","url":"(https://edurev\.in/t/[^"]+)"',
        re.I,
    )
    for title, url in jsonld_pattern.findall(chapter_html):
        candidates.append({"title": clean(title), "url": url})

    anchor_pattern = re.compile(
        r"<a[^>]+href=(/t/[^\s>#]+)[^>]*>(.*?)</a>",
        re.I | re.S,
    )
    for href, inner in anchor_pattern.findall(chapter_html):
        title = clean(re.sub(r"<[^>]+>", " ", inner))
        if "NEET Previous Year Questions" not in title:
            continue
        candidates.append({"title": title, "url": f"{EDUREV_BASE_URL}{href}"})

    unique: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for row in candidates:
        if row["url"] in seen_urls:
            continue
        seen_urls.add(row["url"])
        unique.append(row)

    for row in unique:
        if normalized_chapter in normalize_title(row["title"]):
            return row
    return unique[0] if unique else None


def sources_from_live_pages(class_code: str) -> dict[tuple[str, str], dict[str, Any]]:
    mapping: dict[tuple[str, str], dict[str, Any]] = {}
    for chapter in course_chapters(class_code):
        try:
            html = load_html(chapter["chapter_url"])
            doc = extract_neet_doc(html, chapter["chapter_title"])
        except Exception:
            doc = None
        if not doc:
            continue
        mapping[(class_code, chapter["slug"])] = {
            "source_url": doc["url"],
            "source_label": doc["title"],
            "source_type": "remote_url",
            "chapter_url": chapter["chapter_url"],
        }
    return mapping


def audit_targets(subjects: set[str] | None = None, selected_classes: set[str] | None = None) -> list[dict[str, Any]]:
    source_map: dict[tuple[str, str], dict[str, Any]] = {}

    selected_codes = class_codes(subjects, selected_classes)
    if "B12" in selected_codes:
        source_map.update(b12_sources_from_fault_report())

    for code in selected_codes:
        source_map.update(sources_from_live_pages(code))

    targets: list[dict[str, Any]] = []
    for chapter in chapter_files(subjects, selected_classes):
        key = (chapter["class_code"], chapter["slug"])
        source = source_map.get(key)
        targets.append(
            {
                **chapter,
                "source_url": source.get("source_url") if source else None,
                "source_label": source.get("source_label") if source else None,
                "source_type": source.get("source_type") if source else None,
                "chapter_url": source.get("chapter_url") if source else None,
                "html_path": None,
                "covered": bool(source),
                "coverage_reason": None if source else "no_source_mapping_for_chapter",
            }
        )
    return targets
