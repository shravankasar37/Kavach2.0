"""Kavach API: scores a message with the fine-tuned model plus deterministic signals, and explains the verdict."""
from __future__ import annotations

import os
import re
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import classifier
from .signals import as_dicts, category, detect

app = FastAPI(title="Kavach API", description="Scam message detection for Indian SMS and WhatsApp messages", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3400").split(",") if o],
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeIn(BaseModel):
    text: str = Field(min_length=3, max_length=3000)


def mask_pii(text: str) -> str:
    """Masks phone numbers, long digit runs, UPI IDs and e-mails before anything is logged or stored."""
    text = re.sub(r"[\w.+-]+@[\w.-]+", "[ID]", text)
    text = re.sub(r"(\+?91[\s-]?)?[6-9]\d{9}\b", "[PHONE]", text)
    return re.sub(r"\b\d{6,}\b", "[NUM]", text)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": classifier.available()}


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    t0 = time.perf_counter()
    text = body.text.strip()
    sigs = detect(text)
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
    strong = {"lookalike_domain", "apk"}
    ids = {s.id for s in sigs}
    signals_alarm = (len(sigs) >= 2 and p_signals >= 0.7) or bool(ids & strong)
    if p_model >= 0.8 or (p_model >= thr and signals_alarm) or (len(ids & strong) >= 1 and len(sigs) >= 3):
        level = "high"
    elif p_model >= thr or signals_alarm:
        level = "medium"
    else:
        level = "low"
    floor = {"high": 0.8, "medium": 0.5, "low": 0.0}[level]
    risk = max(p_model, min(p_signals, 0.95) if signals_alarm else 0.0, floor)
    return {
        "risk": round(risk * 100, 1),
        "level": level,
        "category": category(sigs, text) if level != "low" else None,
        "model_probability": round(p_model * 100, 1),
        "signal_score": round(p_signals * 100, 1),
        "signals": as_dicts(sigs),
        "ms": round((time.perf_counter() - t0) * 1000, 1),
    }
