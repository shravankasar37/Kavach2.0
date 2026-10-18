"""Kavach API: scores a message with the fine-tuned model plus deterministic signals, and explains the verdict."""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import classifier, links, store, telegram
from .signals import Signal, as_dicts, category, detect

app = FastAPI(title="Kavach API", description="Scam message detection for Indian SMS and WhatsApp messages", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3400").split(",") if o],
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeIn(BaseModel):
    text: str = Field(min_length=3, max_length=3000)
    deep: bool = True  # also follow links, check domain age, phishing lists and community reports


class LinkIn(BaseModel):
    url: str = Field(min_length=4, max_length=2000)


class Identifier(BaseModel):
    kind: Literal["phone", "upi", "domain"]
    value: str = Field(min_length=3, max_length=200)


class ReportIn(BaseModel):
    items: list[Identifier] = Field(min_length=1, max_length=6)
    category: str | None = Field(default=None, max_length=80)
    text: str = Field(default="", max_length=3000)
    lang: Literal["en", "hi", "mr"] = "en"


_recent: dict[str, deque] = defaultdict(deque)


def _client_ip(req: Request) -> str:
    """The caller's real IP, as set by the proxies in front of the app. Anything the client writes itself is
    ignored: otherwise one person could pose as "3 different reporters" and blacklist someone else's number."""
    # Render sits behind Cloudflare, which sets this header and overwrites any copy the client sends
    if cf := req.headers.get("cf-connecting-ip"):
        return cf.strip()
    # proxies append the address they saw, so the client-controlled part is on the left
    if fwd := req.headers.get("x-forwarded-for"):
        return fwd.split(",")[-1].strip()
    return req.client.host if req.client else "unknown"


def _rate_ok(ip: str, limit: int = 10, per: float = 3600) -> bool:
    q, now = _recent[ip], time.time()
    while q and now - q[0] > per:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def _lookups(text: str) -> list[dict]:
    ids = store.extract_identifiers(text)
    if not ids:
        return []
    try:
        with ThreadPoolExecutor(max_workers=len(ids)) as pool:
            found = list(pool.map(lambda i: store.lookup(i["kind"], i["value"]), ids))
    except Exception:
        return []  # the report database being down must not break a verdict
    # the value comes from the user's own message; it is returned so the report form can send it back
    return [{**f, "value": i["value"]} for i, f in zip(ids, found) if f]


@app.on_event("startup")
def _startup():
    links.warm_lists()
    if telegram.enabled():
        threading.Thread(target=telegram.register_webhook, daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": classifier.available(), "phishing_lists": links.lists_info(), "reports": store.backend(),
            "telegram": telegram.enabled()}


@app.post("/telegram/webhook")
async def telegram_webhook(req: Request):
    if not telegram.enabled() or req.headers.get("x-telegram-bot-api-secret-token") != telegram.SECRET:
        raise HTTPException(403)
    telegram.handle_async(await req.json(), lambda text: analyze(AnalyzeIn(text=text)))
    return {"ok": True}


@app.post("/api/link")
def check_link(body: LinkIn):
    return links.check_link(body.url.strip())


@app.post("/api/report")
def report(body: ReportIn, req: Request):
    ip = _client_ip(req)
    if not _rate_ok(ip):
        raise HTTPException(429, "Too many reports from this connection; please try again later.")
    try:
        saved = store.add_report([i.model_dump() for i in body.items], body.category, body.text, body.lang, ip)
    except Exception:
        raise HTTPException(503, "Report database unavailable")
    return {"saved": saved}


@app.get("/api/lookup")
def lookup(kind: Literal["phone", "upi", "domain"], value: str):
    try:
        found = store.lookup(kind, value)
    except Exception:
        raise HTTPException(503, "Report database unavailable")
    if not found:
        raise HTTPException(422, f"That does not look like a valid {kind}")
    if kind == "domain":
        found["link"] = links.check_link(value)
    return found


@app.get("/api/trending")
def trending():
    try:
        return store.trending()
    except Exception:
        raise HTTPException(503, "Report database unavailable")


@app.post("/api/identifiers")
def identifiers(body: AnalyzeIn):
    """Phone numbers, UPI IDs and websites in a message, for the report form."""
    return store.extract_identifiers(body.text)


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    t0 = time.perf_counter()
    text = body.text.strip()
    sigs: list[Signal] = detect(text)
    link_results = links.check_text_links(text) if body.deep else []
    known = _lookups(text) if body.deep else []
    seen = {s.id for s in sigs}
    for s in links.link_signals(link_results):
        if s.id not in seen:
            seen.add(s.id)
            sigs.append(s)
    flagged = [k for k in known if k["flagged"]]
    if flagged:
        sigs.append(Signal("reported_by_users", f"{flagged[0]['hint']} was reported as a scam by {flagged[0]['reporters']} Kavach users", 0.7, flagged[0]["hint"]))
    sigs.sort(key=lambda s: -s.weight)
    # noisy-OR of the signal weights: independent pieces of evidence add up but never exceed 1
    p_signals = 1.0
    for s in sigs:
        p_signals *= 1 - s.weight
    p_signals = 1 - p_signals
    if not classifier.available():
        raise HTTPException(503, "Model not loaded")
    p_model = classifier.scam_probability(text)
    thr = classifier.threshold()
    # The model decides; signals explain it and can only escalate on solid evidence. A single weak sign
    # ("won", "today", "pay") is common in normal chat, so alone it never flags a message.
    strong = {"lookalike_domain", "apk", "phishing_listed", "upi_receive_trick", "safe_account", "video_arrest"}
    ids = {s.id for s in sigs}
    signals_alarm = (len(sigs) >= 2 and p_signals >= 0.7) or bool(ids & strong)
    # near-certain tricks (a UPI PIN "to receive", a "safe account", a video-call arrest, a listed phishing link)
    # are scams whatever the wording; their rules already skip "never do this" awareness messages
    certain = {"upi_receive_trick", "safe_account", "video_arrest", "phishing_listed"}
    if p_model >= 0.8 or (p_model >= thr and signals_alarm) or (len(ids & strong) >= 1 and len(sigs) >= 3) or ids & certain:
        level = "high"
    elif p_model >= thr or signals_alarm:
        level = "medium"
    else:
        level = "low"
    floor = {"high": 0.8, "medium": 0.5, "low": 0.0}[level]
    risk = max(p_model, min(p_signals, 0.95) if signals_alarm else 0.0, floor)
    cat = category(sigs, text) if level != "low" else None
    if body.deep:
        # anonymous "what kind of scam was checked" count for the trending list, off the request path
        threading.Thread(target=store.log_verdict, args=(cat, level), daemon=True).start()
    return {
        "risk": round(risk * 100, 1),
        "level": level,
        "category": cat,
        "model_probability": round(p_model * 100, 1),
        "signal_score": round(p_signals * 100, 1),
        "signals": as_dicts(sigs),
        "links": link_results,
        "known": known,
        "ms": round((time.perf_counter() - t0) * 1000, 1),
    }
