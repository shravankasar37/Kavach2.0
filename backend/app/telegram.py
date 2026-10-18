"""Kavach on Telegram: forward any suspicious message to the bot and it replies with the verdict in
English, Hindi or Marathi. Free (Telegram Bot API); WhatsApp bots need a paid business account.

Setup: create a bot with @BotFather, put its token in TELEGRAM_BOT_TOKEN on the server. On Render the public
URL is known (RENDER_EXTERNAL_URL), so the webhook registers itself at startup.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import urllib.request
from pathlib import Path
from typing import Callable

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
PUBLIC_URL = (os.environ.get("PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").rstrip("/")
WEB_URL = os.environ.get("WEB_URL", "").rstrip("/")
# Telegram echoes this in a header on every webhook call, so nobody else can post fake updates to us
SECRET = hashlib.sha256(f"kavach-webhook|{TOKEN}".encode()).hexdigest()[:48]
TEXTS = json.loads((Path(__file__).with_name("texts.json")).read_text(encoding="utf-8"))
DOT = {"high": "🔴", "medium": "🟠", "low": "🟢"}
_lang: dict[int, str] = {}  # chat id -> chosen language (in memory; the default is guessed from the text)

WELCOME = {
    "en": "Namaste! I am Kavach 🛡️ Forward me any suspicious SMS or WhatsApp message and I will tell you if it looks like a scam, and why.\n\nLanguage: /english · /hindi · /marathi",
    "hi": "नमस्ते! मैं कवच हूँ 🛡️ कोई भी संदिग्ध SMS या WhatsApp मैसेज मुझे फ़ॉरवर्ड करें, मैं बताऊँगा कि यह धोखाधड़ी लगती है या नहीं, और क्यों।\n\nभाषा: /english · /hindi · /marathi",
    "mr": "नमस्कार! मी कवच आहे 🛡️ कोणताही संशयास्पद SMS किंवा WhatsApp मेसेज मला फॉरवर्ड करा, मी सांगेन की ही फसवणूक वाटते का, आणि का.\n\nभाषा: /english · /hindi · /marathi",
}
PHOTO = {
    "en": "I can read text messages here. For a screenshot, open the Kavach app{url} and tap “Upload a screenshot”.",
    "hi": "यहाँ मैं टेक्स्ट मैसेज पढ़ सकता हूँ। स्क्रीनशॉट के लिए कवच ऐप{url} खोलें और “स्क्रीनशॉट अपलोड करें” दबाएँ।",
    "mr": "इथे मी मजकूर संदेश वाचू शकतो. स्क्रीनशॉटसाठी कवच ॲप{url} उघडा आणि “स्क्रीनशॉट अपलोड करा” दाबा.",
}
LINK = {"en": ("Link", "really goes to", "registered {n} days ago", "on a phishing list"),
        "hi": ("लिंक", "असल में जाता है", "{n} दिन पहले बनी वेबसाइट", "धोखाधड़ी सूची में है"),
        "mr": ("लिंक", "प्रत्यक्षात जाते", "{n} दिवसांपूर्वी नोंदवलेली वेबसाइट", "फसवणूक यादीत आहे")}


def enabled() -> bool:
    return bool(TOKEN)


def _api(method: str, payload: dict) -> dict | None:
    req = urllib.request.Request(f"https://api.telegram.org/bot{TOKEN}/{method}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception:
        return None


def register_webhook() -> bool:
    if not (TOKEN and PUBLIC_URL):
        return False
    res = _api("setWebhook", {"url": f"{PUBLIC_URL}/telegram/webhook", "secret_token": SECRET, "allowed_updates": ["message"],
                              "drop_pending_updates": True})
    return bool(res and res.get("ok"))


def guess_lang(text: str) -> str:
    if not re.search(r"[ऀ-ॿ]", text):
        return "en"
    # words that are Marathi, not Hindi
    return "mr" if re.search(r"(आहे|नाही|तुमचे|तुमच्या|करा|झाले|मध्ये|यांच्याशी|केले|जाईल)", text) else "hi"


def format_verdict(v: dict, lang: str) -> str:
    lv = TEXTS["level"][lang][v["level"]]
    lines = [f"{DOT[v['level']]} {round(v['risk'])}% · {lv['title']}"]
    if v.get("category"):
        lines.append(TEXTS["category"][lang].get(v["category"], v["category"]))
    lines.append(lv["sub"])
    if v["signals"]:
        lines.append("")
        lines.append(TEXTS["ui"][lang]["why"] + ":")
        for s in v["signals"][:5]:
            lines.append("• " + TEXTS["signal"][lang].get(s["id"], s["label"]))
    for r in v.get("links", [])[:2]:
        name, goes, age, listed = LINK[lang]
        parts = [f"{name}: {r['input']}"]
        if r["redirected"] and r["final_domain"]:
            parts.append(f"{goes} {r['final_domain']}")
        if r["domain_age_days"] is not None and r["domain_age_days"] < 365 and not r["official"]:
            parts.append(age.format(n=r["domain_age_days"]))
        if r["phishing_listed"]:
            parts.append("⚠ " + listed)
        lines.append(" · ".join(parts))
    lines += ["", TEXTS["ui"][lang]["canBeWrong"], TEXTS["ui"][lang]["footer"].split(" · ")[0]]
    return "\n".join(lines)


def handle(update: dict, analyze: Callable[[str], dict]) -> None:
    msg = update.get("message") or {}
    chat = (msg.get("chat") or {}).get("id")
    if not chat:
        return
    text = (msg.get("text") or msg.get("caption") or "").strip()
    cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    if cmd in ("/english", "/hindi", "/marathi"):
        _lang[chat] = {"/english": "en", "/hindi": "hi", "/marathi": "mr"}[cmd]
        _api("sendMessage", {"chat_id": chat, "text": WELCOME[_lang[chat]]})
        return
    lang = _lang.get(chat) or guess_lang(text)
    if cmd == "/start" or (cmd and cmd not in ("/check",)):
        _api("sendMessage", {"chat_id": chat, "text": WELCOME[lang]})
        return
    if cmd == "/check":
        text = text[len("/check"):].strip()
    if len(text) < 3:
        if msg.get("photo") or msg.get("document"):
            _api("sendMessage", {"chat_id": chat, "text": PHOTO[lang].format(url=f" ({WEB_URL})" if WEB_URL else "")})
        return
    _api("sendChatAction", {"chat_id": chat, "action": "typing"})
    try:
        reply = format_verdict(analyze(text[:3000]), lang)
    except Exception:
        reply = {"en": "Sorry, I couldn't check that right now. Please try again in a minute.",
                 "hi": "माफ़ करें, अभी जाँच नहीं हो पाई। एक मिनट बाद फिर कोशिश करें।",
                 "mr": "माफ करा, आत्ता तपासणी झाली नाही. एका मिनिटाने पुन्हा प्रयत्न करा."}[lang]
    _api("sendMessage", {"chat_id": chat, "text": reply, "reply_to_message_id": msg.get("message_id"), "disable_web_page_preview": True})


def handle_async(update: dict, analyze: Callable[[str], dict]) -> None:
    """Answer Telegram at once and reply in the background (Telegram retries slow webhooks)."""
    threading.Thread(target=handle, args=(update, analyze), daemon=True).start()
