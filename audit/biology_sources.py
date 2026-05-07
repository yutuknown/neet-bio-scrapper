from __future__ import annotations

import json
import re
import ssl
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BIOLOGY_ROOT = ROOT / "data" / "raw" / "BIOLOGY"
B11_DIR = BIOLOGY_ROOT / "B11" / "chapters"
B12_DIR = BIOLOGY_ROOT / "B12" / "chapters"
FAULT_REPORT_PATH = ROOT / ".debug" / "chapterwise_scraper_faults.json"
B11_COURSE_URL = "https://edurev.in/courses/1822_Biology-Class-11--Notes--Questions--Videos--MCQs"
EDUREV_BASE_URL = "https://edurev.in"


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").replace("\xa0", " ")).strip()


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9\s-]", "", clean(text).replace("&", " and ").lower().replace(" ", "-"))).strip("-")


def normalize_title(text: str) -> str:
    return clean(text).replace("&", " and ").replace("-", " ").lower()


def load_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=120, context=ssl.create_default_context()) as response:
        return response.read().decode("utf-8", "replace")


def chapter_files() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for class_code, chapter_dir in (("B11", B11_DIR), ("B12", B12_DIR)):
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
                    "class_code": class_code,
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


def b11_course_chapters() -> list[dict[str, str]]:
    html = load_html(B11_COURSE_URL)
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


def extract_b11_neet_doc(chapter_html: str, chapter_title: str) -> dict[str, str] | None:
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


def b11_sources_from_live_pages() -> dict[tuple[str, str], dict[str, Any]]:
    mapping: dict[tuple[str, str], dict[str, Any]] = {}
    for chapter in b11_course_chapters():
        try:
            html = load_html(chapter["chapter_url"])
            doc = extract_b11_neet_doc(html, chapter["chapter_title"])
        except Exception:
            doc = None
        if not doc:
            continue
        mapping[("B11", chapter["slug"])] = {
            "source_url": doc["url"],
            "source_label": doc["title"],
            "source_type": "remote_url",
            "chapter_url": chapter["chapter_url"],
        }
    return mapping


def biology_audit_targets() -> list[dict[str, Any]]:
    source_map = {}
    source_map.update(b12_sources_from_fault_report())
    source_map.update(b11_sources_from_live_pages())
    targets: list[dict[str, Any]] = []

    for chapter in chapter_files():
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
