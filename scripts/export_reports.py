"""Feedback loop: turns community scam reports into training rows for the next fine-tuning run.

Reports are already PII-masked when stored (numbers, UPI IDs, e-mails replaced by [PHONE]/[ID]/[NUM]). Only
messages reported by at least MIN_REPORTERS different people are exported, so a single false report never
becomes training data. Run from the repo root:

    backend/.venv/Scripts/python scripts/export_reports.py            # local SQLite (development)
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python scripts/export_reports.py   # production reports

Then add data/community/reports.csv to scripts/prepare_data.py's training sources and re-run the Kaggle kernel.
The held-out real test set is never touched, so before/after numbers stay comparable.
"""
from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app import store  # noqa: E402

OUT = ROOT / "data" / "community" / "reports.csv"


def rows() -> list[dict]:
    if store.backend() == "supabase":
        out, offset = [], 0
        while True:
            page = store._sb("GET", f"reports?select=masked_text,category,lang,reporter,id_hash&order=id.asc&limit=1000&offset={offset}") or []
            out += page
            if len(page) < 1000:
                return out
            offset += 1000
    with store._db() as con:
        return [dict(zip(("masked_text", "category", "lang", "reporter", "id_hash"), r))
                for r in con.execute("select masked_text, category, lang, reporter, id_hash from reports")]


def main() -> int:
    by_text: dict[str, dict] = {}
    reporters: dict[str, set] = defaultdict(set)
    for r in rows():
        t = (r["masked_text"] or "").strip()
        if len(t) < 15:
            continue
        reporters[t].add(r["reporter"])
        by_text.setdefault(t, r)
    keep = [(t, r) for t, r in by_text.items() if len(reporters[t]) >= store.MIN_REPORTERS]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "label", "source", "category", "lang", "reporters"])
        for t, r in keep:
            w.writerow([t, 1, "kavach_community", r["category"] or "", r["lang"] or "", len(reporters[t])])
    print(f"{len(by_text)} distinct reported messages, {len(keep)} confirmed by >= {store.MIN_REPORTERS} people -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
