"""End-to-end check of the full verdict (model + signals + policy) on held-out real messages.

Run from backend/:  python eval_verdict.py
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from app.main import AnalyzeIn, analyze

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    rows = list(csv.DictReader(open(ROOT / "data/prepared/test_real.csv", encoding="utf-8")))
    caught = missed = false_alarm = genuine = 0
    misses, alarms = [], []
    for r in rows:
        v = analyze(AnalyzeIn(text=r["text"], deep=False))
        flagged = v["level"] != "low"
        if r["label"] == "1":
            caught += flagged
            missed += not flagged
            if not flagged:
                misses.append(r["text"][:90])
        else:
            genuine += 1
            false_alarm += flagged
            if flagged:
                alarms.append((v["level"], r["text"][:90]))
    scams = caught + missed
    print(f"real held-out test: {caught}/{scams} scams flagged ({100 * caught / scams:.1f}%), "
          f"{false_alarm}/{genuine} genuine flagged ({100 * false_alarm / genuine:.2f}%)")
    for lv, t in alarms:
        print(f"  false alarm [{lv}]: {t}")

    wild = [json.loads(line) for line in open(ROOT / "data/real/india_in_the_wild.jsonl", encoding="utf-8")]
    high = sum(analyze(AnalyzeIn(text=w["text"], deep=False))["level"] == "high" for w in wild)
    print(f"Indian scams quoted in news: {high}/{len(wild)} high risk")
    return 0 if false_alarm / genuine <= 0.005 and caught / scams >= 0.95 and high == len(wild) else 1


if __name__ == "__main__":
    sys.exit(main())
