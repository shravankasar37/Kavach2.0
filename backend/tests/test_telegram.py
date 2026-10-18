"""Telegram bot replies, with the Telegram API replaced by a recorder (no network, no token)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import telegram  # noqa: E402

VERDICT = {"risk": 99.0, "level": "high", "category": "Fake electricity disconnection", "signals": [
    {"id": "threat_block", "label": "Threatens to block, suspend or cut your account, SIM or power"},
    {"id": "call_personal_number", "label": "Tells you to call or WhatsApp a personal mobile number"}], "links": []}


def run(text, chat=1, **extra):
    sent = []
    telegram._api = lambda method, payload: sent.append((method, payload))
    telegram.handle({"message": {"chat": {"id": chat}, "message_id": 7, "text": text, **extra}}, lambda t: VERDICT)
    return [p["text"] for m, p in sent if m == "sendMessage"]


def test_language_follows_the_message():
    assert telegram.guess_lang("Your power will be cut") == "en"
    assert telegram.guess_lang("आपका बिजली कनेक्शन आज रात काट दिया जाएगा") == "hi"
    assert telegram.guess_lang("तुमचे वीज कनेक्शन आज रात्री बंद केले जाईल") == "mr"


def test_hindi_reply_for_hindi_message():
    out = run("आपका बिजली कनेक्शन आज रात काट दिया जाएगा", chat=11)
    assert len(out) == 1 and "🔴 99%" in out[0]
    assert "नकली बिजली कनेक्शन" in out[0] and "खाता, SIM या बिजली बंद करने की धमकी" in out[0]


def test_language_command_sticks():
    run("/marathi", chat=12)
    out = run("Your power will be cut tonight, call 9876543210", chat=12)
    assert "वीज" in out[0] or "धमकी" in out[0]


def test_start_and_photo():
    assert "Kavach" in run("/start", chat=13)[0]
    assert "screenshot" in run("", chat=14, photo=[{"file_id": "x"}])[0]
