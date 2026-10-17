"""Regression tests for the deterministic scam signals: real scams must raise the right signals, and everyday
genuine messages (bank alerts, OTPs, family chat) must raise none."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.signals import category, detect  # noqa: E402

SCAMS = {
    "Dear Consumer Your Electricity power will be disconnected. Tonight at 9.30 pm from electricity office. because your previous month bill was not update. Please immediately contact with our electricity officer 8260303942 Thank you.":
        ({"threat_block", "call_personal_number"}, "Fake electricity disconnection"),
    "India Post: Your package has arrived at the warehouse and we attempted delivery twice but were unable due to incomplete address. Please update your address within 48 hours: indiapost-go-in.one/index":
        ({"lookalike_domain", "courier_address"}, "Fake parcel / courier"),
    "Dear customer your SBI KYC expires today. Update now or account will be blocked: sbi-kyc-update.top/verify":
        ({"lookalike_domain", "kyc_update", "risky_domain"}, "Fake KYC update"),
    "आपका बिजली कनेक्शन आज रात 9:30 बजे काट दिया जाएगा। तुरंत 9876543210 पर संपर्क करें।":
        ({"threat_block", "call_personal_number"}, "Fake electricity disconnection"),
    "Spend a few minutes every day. You can earn 30,000 per month. Long press the message or reply to the number 1 to join us":
        ({"job_offer"}, "Fake job / task scam"),
    "Download the SBI rewards app to redeem points: sbi-points.apk": ({"apk"}, None),
}

GENUINE = [
    "Rs.500.00 debited from A/c XX1234 on 17-10-26 to VPA shop@okaxis. Not you? Call 1800 1234 -SBI",
    "Your OTP for Uber login is 9460. Valid for 5 mins. Do not share.",
    "Hi beta, I'll reach home by 8. Keep the gate open.",
    "These won't do. Have to move on to morphine",
    "I might come to kerala for 2 days.so you can be prepared to take a leave once i finalise .",
    "They are just making it easy to pay back. I have 2 yrs to say but i can pay back earlier.",
    "Your Amazon order #402-123 has been shipped and will arrive by Tuesday.",
]


def test_scams_raise_expected_signals():
    for text, (expected, cat) in SCAMS.items():
        ids = {s.id for s in detect(text)}
        assert expected <= ids, (text[:50], expected - ids)
        if cat:
            assert category(detect(text), text) == cat, text[:50]


def test_genuine_messages_raise_no_signals():
    for text in GENUINE:
        assert detect(text) == [], (text, [s.id for s in detect(text)])
