"""Community reports: privacy (no raw numbers stored), the 3-distinct-reporters rule, and identifier extraction."""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

os.environ["KAVACH_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ.pop("SUPABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import store  # noqa: E402

MSG = "Your electricity will be cut tonight. Call 98765 43210 or pay to refund.desk@ybl at sbi-kyc-help.top/pay"


def test_extracts_phone_upi_and_website():
    kinds = {(i["kind"], i["value"]) for i in store.extract_identifiers(MSG)}
    assert ("phone", "9876543210") in kinds
    assert ("upi", "refund.desk@ybl") in kinds
    assert ("domain", "sbi-kyc-help.top") in kinds
    # an e-mail address is not a UPI ID
    assert not [i for i in store.extract_identifiers("mail me at ravi@gmail.com") if i["kind"] == "upi"]


def test_flagged_only_after_three_different_reporters():
    item = [{"kind": "phone", "value": "+91 98765 43210"}]
    for _ in range(5):  # one person reporting many times
        store.add_report(item, "Fake electricity disconnection", MSG, "en", "1.1.1.1")
    assert store.lookup("phone", "9876543210")["flagged"] is False
    store.add_report(item, "Fake electricity disconnection", MSG, "hi", "2.2.2.2")
    store.add_report(item, "Fake electricity disconnection", MSG, "mr", "3.3.3.3")
    found = store.lookup("phone", "09876543210")
    assert found["flagged"] and found["reporters"] == 3 and found["hint"] == "XXXXXX3210"


def test_database_holds_no_raw_numbers():
    store.add_report([{"kind": "upi", "value": "refund.desk@ybl"}], None, MSG, "en", "4.4.4.4")
    dump = "\n".join(sqlite3.connect(os.environ["KAVACH_DB"]).iterdump())
    assert "9876543210" not in dump and "98765 43210" not in dump and "refund.desk@ybl" not in dump
    assert "4.4.4.4" not in dump


def test_trending_counts_categories():
    store.log_verdict("Fake KYC update", "high")
    store.log_verdict("Fake KYC update", "medium")
    store.log_verdict(None, "low")
    t = store.trending()
    assert t["categories"][0] == {"category": "Fake KYC update", "count": 2}
