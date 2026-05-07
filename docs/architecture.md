# Repository architecture

## Source code

- `scraper/` — chapter discovery, PYQ discovery, and question scraping entrypoints
- `audit/` — benchmark scoring, alignment, and report generation
- `dashboard/` — static dashboard and generated browser-ready data

## Generated data

- `data/raw/` — scraped chapter, PYQ, and question JSON
- `data/assets/` — downloaded chapter assets referenced by question JSON
- `audit/reports/` — generated benchmark and audit outputs
- `dashboard/data/` — browser-side snapshots built from raw data and audit reports

## Reference inputs

- `fixtures/` — bundled EduRev HTML fixtures used for validation

## Internal-only workspace

- `.backup/` — older source copies kept as reference only
- `.debug/` — temporary scans and diagnostics
- `node_modules/` — installed dependencies

## Publishing rule

Keep generated outputs that the dashboard needs, but do not expose scratch or backup material as part of the documented public workflow.