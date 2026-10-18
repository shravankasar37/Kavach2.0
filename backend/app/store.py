"""Community scam reports and anonymous trend counts.

Privacy by design:
- a reported phone number or UPI ID is stored only as a salted SHA-256 hash plus a masked hint (XXXXXX3210),
  so the database cannot be read back as a list of numbers; lookups hash the query the same way;
- the reporter is a salted hash of their IP, kept only to count *distinct* reporters;
- message text is stored with phone numbers, UPI IDs, e-mails and long digit runs masked.
A number counts as "reported" only after MIN_REPORTERS different people report it, so one person cannot
blacklist someone else's number.

Backend: Supabase (PostgREST) when SUPABASE_URL and SUPABASE_SERVICE_KEY are set, else a local SQLite file
(good for development; on Render's free tier its disk is wiped on every restart).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

MIN_REPORTERS = 3
WINDOW_DAYS = 90
SALT = os.environ.get("REPORT_SALT", "kavach-local-dev-salt")
SB_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
DB_PATH = Path(os.environ.get("KAVACH_DB", Path(__file__).resolve().parent.parent / "kavach_local.db"))

# a UPI handle (name@ybl) has no ".com" after it; a full stop that ends the sentence is fine
UPI_RE = re.compile(r"\b[a-z0-9._-]{2,64}@[a-z]{2,20}\b(?!\.[a-z])", re.I)
PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)")
DOMAIN_RE = re.compile(r"(?:https?://)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:/\S*)?", re.I)


def mask_pii(text: str) -> str:
    text = re.sub(r"[\w.+-]+@[\w.-]+", "[ID]", text)
    text = PHONE_RE.sub("[PHONE]", text)
    return re.sub(r"\b\d{6,}\b", "[NUM]", text)


def normalize(kind: str, value: str) -> str | None:
    v = value.strip().lower()
    if kind == "phone":
        digits = re.sub(r"\D", "", v)
        digits = digits[-10:] if len(digits) >= 10 else ""
        return digits if re.fullmatch(r"[6-9]\d{9}", digits) else None
    if kind == "upi":
        return v if UPI_RE.fullmatch(v) else None
    if kind == "domain":
        m = DOMAIN_RE.fullmatch(v)
        return m.group(1) if m else None
    return None


def hint(kind: str, norm: str) -> str:
    if kind == "phone":
        return "XXXXXX" + norm[-4:]
    if kind == "upi":
        user, _, handle = norm.partition("@")
        return (user[:2] + "***" + "@" + handle) if len(user) > 2 else "***@" + handle
    return norm  # websites are not personal data


def id_hash(kind: str, norm: str) -> str:
    return hashlib.sha256(f"{SALT}|{kind}|{norm}".encode()).hexdigest()


def reporter_hash(ip: str) -> str:
    return hashlib.sha256(f"{SALT}|reporter|{ip}".encode()).hexdigest()[:32]


def extract_identifiers(text: str) -> list[dict]:
    """Phone numbers, UPI IDs and websites in a message, for the report form and the automatic lookup."""
    out, seen = [], set()
    for m in PHONE_RE.finditer(text):
        n = normalize("phone", m.group(0))
        if n and ("phone", n) not in seen:
            seen.add(("phone", n))
            out.append({"kind": "phone", "value": n, "hint": hint("phone", n)})
    for m in UPI_RE.finditer(text):
        n = normalize("upi", m.group(0))
        # e-mail addresses look like UPI IDs; a UPI handle has no dot after the @
        if n and "." not in n.partition("@")[2] and ("upi", n) not in seen:
            seen.add(("upi", n))
            out.append({"kind": "upi", "value": n, "hint": hint("upi", n)})
    from .signals import URL_RE  # same link rule as the scam signals

    for m in URL_RE.finditer(text):
        host = (m.group(1) or m.group(3) or "").lower().strip(".")
        host = host[4:] if host.startswith("www.") else host
        if host.count(".") and ("domain", host) not in seen:
            seen.add(("domain", host))
            out.append({"kind": "domain", "value": host, "hint": host})
    return out[:6]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- SQLite (local) ----------
_lock = threading.Lock()


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.executescript(
        """
        create table if not exists reports (id integer primary key, created_at text, kind text, id_hash text, id_hint text,
            category text, masked_text text, lang text, reporter text);
        create index if not exists reports_hash on reports(id_hash);
        create table if not exists verdict_events (id integer primary key, created_at text, category text, level text);
        """
    )
    return con


# ---------- Supabase (production) ----------
def _sb(method: str, path: str, body: object | None = None, prefer: str | None = None):
    headers = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=6) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def backend() -> str:
    return "supabase" if SB_URL and SB_KEY else "sqlite"


def add_report(items: list[dict], category: str | None, text: str, lang: str, ip: str) -> int:
    rows = []
    rep = reporter_hash(ip)
    for it in items:
        n = normalize(it["kind"], it["value"])
        if not n:
            continue
        rows.append({"created_at": _now().isoformat(), "kind": it["kind"], "id_hash": id_hash(it["kind"], n), "id_hint": hint(it["kind"], n),
                     "category": category, "masked_text": mask_pii(text)[:1000], "lang": lang, "reporter": rep})
    if not rows:
        return 0
    if backend() == "supabase":
        _sb("POST", "reports", rows, prefer="return=minimal")
    else:
        with _lock, _db() as con:
            con.executemany("insert into reports (created_at, kind, id_hash, id_hint, category, masked_text, lang, reporter) "
                            "values (:created_at, :kind, :id_hash, :id_hint, :category, :masked_text, :lang, :reporter)", rows)
    return len(rows)


def lookup(kind: str, value: str) -> dict | None:
    n = normalize(kind, value)
    if not n:
        return None
    h = id_hash(kind, n)
    since = (_now() - timedelta(days=WINDOW_DAYS)).isoformat()
    if backend() == "supabase":
        rows = _sb("GET", f"reports?select=created_at,category,reporter&id_hash=eq.{h}&created_at=gte.{urllib.parse.quote(since)}&limit=500") or []
    else:
        with _lock, _db() as con:
            rows = [dict(zip(("created_at", "category", "reporter"), r)) for r in
                    con.execute("select created_at, category, reporter from reports where id_hash=? and created_at>=?", (h, since))]
    reporters = {r["reporter"] for r in rows}
    cats: dict[str, int] = {}
    for r in rows:
        if r["category"]:
            cats[r["category"]] = cats.get(r["category"], 0) + 1
    return {
        "kind": kind, "hint": hint(kind, n), "reporters": len(reporters), "reports": len(rows),
        "flagged": len(reporters) >= MIN_REPORTERS, "last_reported": max((r["created_at"] for r in rows), default=None),
        "categories": sorted(cats, key=lambda c: -cats[c])[:3], "window_days": WINDOW_DAYS, "min_reporters": MIN_REPORTERS,
    }


def log_verdict(category: str | None, level: str) -> None:
    """Anonymous count of what kinds of scams people are checking (no text, no identifiers)."""
    if level == "low" or not category:
        return
    row = {"created_at": _now().isoformat(), "category": category, "level": level}
    try:
        if backend() == "supabase":
            _sb("POST", "verdict_events", row, prefer="return=minimal")
        else:
            with _lock, _db() as con:
                con.execute("insert into verdict_events (created_at, category, level) values (:created_at, :category, :level)", row)
    except Exception:
        pass  # trends are best-effort; never fail a verdict because of them


def trending(days: int = 7) -> dict:
    since = (_now() - timedelta(days=days)).isoformat()
    if backend() == "supabase":
        events = _sb("GET", f"verdict_events?select=category&created_at=gte.{urllib.parse.quote(since)}&limit=5000") or []
        reports = _sb("GET", f"reports?select=kind,id_hint,reporter&kind=eq.domain&created_at=gte.{urllib.parse.quote(since)}&limit=2000") or []
    else:
        with _lock, _db() as con:
            events = [{"category": r[0]} for r in con.execute("select category from verdict_events where created_at>=?", (since,))]
            reports = [dict(zip(("kind", "id_hint", "reporter"), r)) for r in
                       con.execute("select kind, id_hint, reporter from reports where kind='domain' and created_at>=?", (since,))]
    cats: dict[str, int] = {}
    for e in events:
        cats[e["category"]] = cats.get(e["category"], 0) + 1
    domains: dict[str, set] = {}
    for r in reports:
        domains.setdefault(r["id_hint"], set()).add(r["reporter"])
    return {
        "days": days,
        "checks": sum(cats.values()),
        "categories": [{"category": c, "count": n} for c, n in sorted(cats.items(), key=lambda x: -x[1])[:6]],
        # only websites several people reported, so the list can't be used to defame a site
        "domains": [{"domain": d, "reporters": len(rs)} for d, rs in sorted(domains.items(), key=lambda x: -len(x[1])) if len(rs) >= MIN_REPORTERS][:5],
        "backend": backend(),
    }
