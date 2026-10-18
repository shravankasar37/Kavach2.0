"""Builds Kavach's train/validation/test files from the downloaded corpora (data/raw) into data/prepared.

    py -3.12 -I scripts/prepare_data.py

- test_real.csv: 20% stratified split of the real SMS Smishing Collection, carved out FIRST and never used for
  training or model selection. Headline accuracy is reported only on this file.
- train.csv / val.csv: the remaining real messages plus two synthetic Indian sets (audited multilingual set,
  de-templated Hinglish set). Validation is drawn from training sources only.
- The "Indian Scam SMS 30k" set is excluded on purpose: its scam URLs literally contain the word "scam"
  (label leakage), so a model would learn the URL string, not fraud.
Labels: 1 = scam/smishing, 0 = safe.
"""
import csv
import random
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "prepared"
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(26_104)


def norm(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


def skeleton(t: str) -> str:
    """Text with digits, URLs and names collapsed: two messages with the same skeleton come from one template."""
    t = t.lower()
    t = re.sub(r"https?://\S+|\b\S+\.(in|com|top|xyz|link|info|net)\S*", "<url>", t)
    t = re.sub(r"\d+", "#", t)
    return re.sub(r"[^a-zऀ-ॿ#<> ]+", "", t)


# ---- real: SMS Smishing Collection (UCI-derived, real messages) ----
real = []
with open(RAW / "sms-smishing-collection-data-set" / "smssmishcollection" / "SMSSmishCollection.txt", encoding="utf-8", errors="replace") as f:
    for line in f:
        if "\t" not in line:
            continue
        lab, text = line.split("\t", 1)
        lab = lab.strip().lower()
        if lab in ("ham", "smish") and norm(text):
            real.append((norm(text), 1 if lab == "smish" else 0, "smish_collection"))
seen, uniq = set(), []
for r in real:
    if r[0].lower() not in seen:
        seen.add(r[0].lower())
        uniq.append(r)
real = uniq

by_label = {0: [r for r in real if r[1] == 0], 1: [r for r in real if r[1] == 1]}
test, real_train = [], []
for lab, rows in by_label.items():
    rng.shuffle(rows)
    k = round(len(rows) * 0.2)
    test += rows[:k]
    real_train += rows[k:]
test_texts = {t.lower() for t, _, _ in test}

# ---- synthetic: audited multilingual Indian set ----
syn = []
with open(RAW / "hf" / "Ridham115_indian-scam-sms-synthetic-audited" / "data" / "synthetic_audited.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row["label"] in ("scam", "safe") and norm(row["text"]):
            syn.append((norm(row["text"]), 1 if row["label"] == "scam" else 0, "synthetic_audited"))

# ---- synthetic: Hinglish set, one message per template skeleton ----
hing, skel = [], set()
with open(RAW / "india-cyber-scam-hinglish-dataset" / "India_Cyber_Scam_Hinglish_Dataset.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        t = norm(row["text"])
        s = skeleton(t)
        if t and row["label"] in ("0", "1") and s not in skel:
            skel.add(s)
            hing.append((t, int(row["label"]), "synthetic_hinglish"))

# ---- community reports (feedback loop): scams confirmed by >= 3 different Kavach users, PII-masked ----
# produced by scripts/export_reports.py; absent until the app has real reports
community = []
COMMUNITY = ROOT / "data" / "community" / "reports.csv"
if COMMUNITY.exists():
    with open(COMMUNITY, encoding="utf-8") as f:
        community = [(norm(row["text"]), 1, "kavach_community") for row in csv.DictReader(f) if norm(row["text"])]

pool = [r for r in real_train + syn + hing + community if r[0].lower() not in test_texts]
rng.shuffle(pool)
n_val = round(len(pool) * 0.1)
val, train = pool[:n_val], pool[n_val:]


def write(name, rows):
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "label", "source"])
        w.writerows(rows)
    c = Counter((s, l) for _, l, s in rows)
    print(f"{name:15s} {len(rows):6d}  " + "  ".join(f"{s}:{'scam' if l else 'safe'}={n}" for (s, l), n in sorted(c.items())))


write("train.csv", train)
write("val.csv", val)
write("test_real.csv", test)
print(f"hinglish kept {len(hing)} of the rows after template de-duplication")
