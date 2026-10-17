"""Deterministic scam signals: the explainable half of Kavach's verdict.

Each signal is a named, human-readable reason with the matched evidence, so the UI can say *why* a message is
risky. Patterns cover English, Hindi (Devanagari) and Hinglish/Marathi in Roman script.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from urllib.parse import urlparse

# Official domains of brands scammers impersonate most (a brand word on any other domain is a lookalike)
OFFICIAL = {
    "sbi": ["sbi.co.in", "onlinesbi.sbi", "sbi.bank.in"], "hdfc": ["hdfcbank.com", "hdfc.bank.in"], "icici": ["icicibank.com", "icici.bank.in"],
    "axis": ["axisbank.com", "axis.bank.in"], "kotak": ["kotak.com", "kotak.bank.in"], "pnb": ["pnbindia.in", "pnb.bank.in"],
    "indiapost": ["indiapost.gov.in"], "india post": ["indiapost.gov.in"], "paytm": ["paytm.com"], "phonepe": ["phonepe.com"],
    "amazon": ["amazon.in", "amazon.com"], "flipkart": ["flipkart.com"], "bluedart": ["bluedart.com"], "fedex": ["fedex.com"],
    "income tax": ["incometax.gov.in"], "incometax": ["incometax.gov.in"], "echallan": ["echallan.parivahan.gov.in"], "parivahan": ["parivahan.gov.in"],
    "trai": ["trai.gov.in"], "uidai": ["uidai.gov.in"], "aadhaar": ["uidai.gov.in"], "bsnl": ["bsnl.co.in"], "jio": ["jio.com"], "airtel": ["airtel.in"],
}
SHORTENERS = {"bit.ly", "tinyurl.com", "t.ly", "cutt.ly", "is.gd", "rb.gy", "shorturl.at", "tiny.cc", "goo.gl", "ow.ly", "s.id", "rebrand.ly"}
RISKY_TLDS = {"top", "xyz", "link", "info", "online", "site", "click", "live", "icu", "buzz", "rest", "cfd", "sbs", "shop", "vip", "cc", "one", "life", "work", "support"}

# a link needs a scheme, "www." or a real domain ending, so "finalise ." or "Rs.500" are not links
TLDS = "in|com|org|net|co|gov|top|xyz|link|info|online|site|click|live|icu|buzz|shop|vip|cc|one|life|work|support|ly|me|io|app|tk|ml|ga|cf|gq|cfd|sbs|rest"
URL_RE = re.compile(rf"(?:https?://|www\.)((?:[a-z0-9-]+\.)+[a-z]{{2,}})(/\S*)?|\b((?:[a-z0-9-]+\.)+(?:{TLDS}))\b(/\S*)?", re.I)


@dataclass
class Signal:
    id: str
    label: str  # shown to the user
    weight: float  # 0-1 contribution to risk
    evidence: str


def _rx(*words: str) -> re.Pattern:
    return re.compile("|".join(words), re.I)


PATTERNS: list[tuple[str, str, float, re.Pattern]] = [
    ("asks_otp", "Asks you to share an OTP, PIN, CVV or password", 0.9,
     _rx(r"\b(share|send|tell|give|batao|bhejo|बताएं|भेजें)\b.{0,30}\b(otp|pin|cvv|password)\b", r"\b(otp|pin|cvv)\b.{0,25}\b(share|send|batao|bhej|बताएं|भेज)", r"ओटीपी")),
    ("threat_block", "Threatens to block, suspend or cut your account, SIM or power", 0.6,
     _rx(r"\b(block(ed)?|suspend(ed)?|deactivat\w*|disconnect\w*|band ho|cut off|kaat|terminate\w*)\b", r"ब्लॉक", r"बंद (हो|कर)", r"काट (दिया|दी)", r"कट जाएगा")),
    ("urgency", "Creates urgency: today, tonight, within hours", 0.4,
     _rx(r"\b(today|tonight|immediately|urgent(ly)?|within \d+ ?(hours?|hrs?|minutes?|mins?)|in \d+ ?hours?|last (date|chance|warning)|turant|abhi|aaj raat|aaj hi)\b", r"आज रात", r"तुरंत", r"घंटे में")),
    ("kyc_update", "Asks you to update KYC, PAN or Aadhaar through a message", 0.55,
     _rx(r"\b(kyc|pan( card)?|aadhaar|aadhar)\b.{0,40}\b(update|expire\w*|pending|verify|link|suspend\w*|block\w*)\b", r"\b(update|verify)\b.{0,30}\b(kyc|pan|aadhaar)\b", r"केवाईसी")),
    ("payment_ask", "Asks you to pay a fee, charge or penalty to unlock something", 0.55,
     _rx(r"\b(pay|payment|fee|charges?|penalty|deposit|registration (fee|amount))\b.{0,40}(₹|\brs\.?\s?\d|\binr\b|\brupees?\b|\brupaye\b)",
         r"(₹|\brs\.?)\s?\d+.{0,30}\b(to release|to unlock|clearance|to activate|fine|bharo)\b", r"\d+\s?(rupaye|rupees)\s?bharo", r"शुल्क", r"जमा कर")),
    ("prize", "Promises a prize, lottery, reward or refund you didn't expect", 0.55,
     _rx(r"\b(you('ve| have)? won|winner|lottery|lucky draw|jackpot|prize|cashback of|reward points? worth|refund of|claim (now|your))\b", r"इनाम", r"लॉटरी")),
    ("job_offer", "Offers easy money: part-time job, daily pay, tasks", 0.55,
     _rx(r"\b(part[- ]?time|work from home|earn (₹|rs|upto|up to)?\s?\d|per day|daily (income|payment|salary)|like (videos|youtube)|rate (hotels|movies)|tasks?)\b.{0,60}\b(earn|income|salary|₹|rs)\b", r"\bearn\b.{0,20}(₹|rs\.?)\s?[\d,]+.{0,15}(day|daily|month)",
         r"\bearn\b\s(upto |up to )?(₹|rs\.? ?)?\d[\d,]{2,}\s?(per|a|every)\s(day|month|week)", r"\bspend a few minutes\b", r"घर बैठे", r"रोज़? कमाएं")),
    ("apk", "Asks you to install an app from a link (APK) or a screen-sharing app", 0.8,
     _rx(r"\.apk\b", r"\b(anydesk|teamviewer|quick ?support|rustdesk)\b", r"\bdownload\b.{0,30}\bapp\b.{0,30}(link|below)")),
    ("courier_address", "Says a parcel is held, or needs your address or a customs fee", 0.45,
     _rx(r"\b(parcel|package|shipment|courier|consignment)\b.{0,140}\b(held|hold|returned|failed|incomplete address|update (your )?address|customs)\b", r"पार्सल")),
    ("authority_impersonation", "Claims to be police, CBI, customs, TRAI, RBI or a court", 0.5,
     _rx(r"\b(cbi|customs|narcotics|cyber ?(cell|crime branch)|trai|rbi|court|arrest warrant|digital arrest|police)\b")),
    ("call_personal_number", "Tells you to call or WhatsApp a personal mobile number", 0.45,
     _rx(r"\b(call|contact|whatsapp|sampark)\b.{0,40}(\+?91[\s-]?)?[6-9]\d{9}\b", r"\bofficer\b.{0,20}[6-9]\d{9}\b", r"[6-9]\d{9}.{0,15}(पर )?(संपर्क|कॉल|फोन)")),
]


def url_signals(text: str) -> list[Signal]:
    out: list[Signal] = []
    for m in URL_RE.finditer(text):
        host = (m.group(1) or m.group(3) or "").lower().strip(".")
        if re.fullmatch(r"[\d.]+", host) or host.count(".") == 0:
            continue
        tld = host.rsplit(".", 1)[-1]
        # ignore things like "Rs.500" or "a.m." caught by the loose pattern
        if tld in {"m"} or len(tld) > 12:
            continue
        if host in SHORTENERS:
            out.append(Signal("shortener", "Uses a link shortener that hides the real website", 0.5, host))
        if tld in RISKY_TLDS:
            out.append(Signal("risky_domain", f"Link ends in .{tld}, a domain ending scammers favour", 0.45, host))
        flat = host.replace("-", "").replace(".", " ")
        for brand, domains in OFFICIAL.items():
            if brand.replace(" ", "") in flat.replace(" ", "") and not any(host == d or host.endswith("." + d) for d in domains):
                out.append(Signal("lookalike_domain", f"Link pretends to be {brand.upper()} but is not its official website", 0.85, host))
                break
    if not out and URL_RE.search(text) and re.search(r"\b(click|tap|visit|open|update|verify)\b", text, re.I):
        out.append(Signal("asks_click", "Asks you to click a link", 0.25, ""))
    return out


def detect(text: str) -> list[Signal]:
    sigs = [Signal(i, label, w, m.group(0)[:80]) for i, label, w, rx in PATTERNS if (m := rx.search(text))]
    sigs += url_signals(text)
    seen, uniq = set(), []
    for s in sorted(sigs, key=lambda s: -s.weight):
        if s.id not in seen:
            seen.add(s.id)
            uniq.append(s)
    return uniq


CATEGORY_ORDER = ["apk", "asks_otp", "kyc_update", "courier_address", "job_offer", "prize", "authority_impersonation", "payment_ask", "threat_block"]
CATEGORY_NAME = {
    "apk": "Malicious app / remote access", "asks_otp": "OTP / credential theft", "kyc_update": "Fake KYC update",
    "courier_address": "Fake parcel / courier", "job_offer": "Fake job / task scam", "prize": "Fake prize or refund",
    "authority_impersonation": "Impersonating an authority", "payment_ask": "Advance-fee demand", "threat_block": "Fake disconnection / blocking",
}


def category(sigs: list[Signal], text: str = "") -> str | None:
    ids = {s.id for s in sigs}
    if re.search(r"electric|bijli|बिजली|power will be", " ".join(s.evidence.lower() for s in sigs) + " " + text.lower()):
        return "Fake electricity disconnection"
    found = next((CATEGORY_NAME[c] for c in CATEGORY_ORDER if c in ids), None)
    return found or ("Impersonation link" if "lookalike_domain" in ids else None)


def as_dicts(sigs: list[Signal]) -> list[dict]:
    return [asdict(s) for s in sigs]
