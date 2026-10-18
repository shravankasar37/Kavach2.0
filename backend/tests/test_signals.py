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
    "प्रिय ग्राहक, तुमचे वीज कनेक्शन आज रात्री 9:30 वाजता बंद केले जाईल. ताबडतोब वीज अधिकारी 9876543210 यांच्याशी संपर्क साधा.":
        ({"threat_block", "urgency", "call_personal_number"}, "Fake electricity disconnection"),
    "Congrats! You won Rs 5000 cashback. Scan this QR and enter your UPI PIN to receive the money.":
        ({"upi_receive_trick"}, "UPI QR / collect-request trick"),
    "रिफंड पाने के लिए यह QR स्कैन करें और पिन डालें": ({"upi_receive_trick"}, "UPI QR / collect-request trick"),
    "परतावा मिळवण्यासाठी हा QR स्कॅन करा": ({"upi_receive_trick"}, "UPI QR / collect-request trick"),
    "मी मुंबई पोलीस मधून बोलतोय, तुमच्यावर डिजिटल अरेस्ट वॉरंट आहे": ({"authority_impersonation"}, None),
    # call transcripts (Call Guard)
    "A parcel in your name with MDMA drugs was seized. An FIR is registered against you. You are under digital arrest. Do not disconnect the call and don't tell your family. Transfer all money to the RBI verification account.":
        ({"video_arrest", "crime_accusation", "secrecy", "safe_account"}, "Digital arrest / fake police"),
    "हम CBI से बोल रहे हैं। आपके आधार पर मनी लॉन्ड्रिंग का केस दर्ज है। आप डिजिटल अरेस्ट में हैं, फ़ोन मत काटिए और किसी को मत बताइए। अपना पैसा सुरक्षित खाते में ट्रांसफर करें।":
        ({"video_arrest", "crime_accusation", "secrecy", "safe_account"}, "Digital arrest / fake police"),
    "मी मुंबई पोलीस मधून बोलतोय. तुमच्या आधार वर गुन्हा दाखल आहे. कोणाला सांगू नका, फोन ठेवू नका. तुमचे पैसे सुरक्षित खात्यात पाठवा.":
        ({"crime_accusation", "secrecy", "safe_account"}, "Digital arrest / fake police"),
    # real Whisper output for a Marathi call: no punctuation, ASR spellings, and the caller's own "सांगू नका"
    # right before the money instruction
    "नमस्कार, मी मुंबई पोलिस मधुन इंस्पेक्टर पाटील बोलतोई. तुमचा नावा वर एक पारसल पकडला है जात ब्रकसाहे. तुमचा वर गुन्हा दाखल जाला है. कोणाला ही सांगू नका आणी फोन ठेवू नका चवक्षी साथी तुमचे सब्ये पैसे सुरक्षित खात्यात पाठवा":
        ({"crime_accusation", "secrecy", "safe_account", "authority_impersonation"}, "Digital arrest / fake police"),
}

GENUINE = [
    "Rs.500.00 debited from A/c XX1234 on 17-10-26 to VPA shop@okaxis. Not you? Call 1800 1234 -SBI",
    "Your OTP for Uber login is 9460. Valid for 5 mins. Do not share.",
    "Hi beta, I'll reach home by 8. Keep the gate open.",
    "These won't do. Have to move on to morphine",
    "I might come to kerala for 2 days.so you can be prepared to take a leave once i finalise .",
    "They are just making it easy to pay back. I have 2 yrs to say but i can pay back earlier.",
    "Your Amazon order #402-123 has been shipped and will arrive by Tuesday.",
    "SBI never asks you to enter UPI PIN to receive money. Do not scan unknown QR codes.",
    "पैसे मिळवण्यासाठी कधीही QR स्कॅन करू नका",
    "तुमचे वीज बिल ₹840 आहे. देय तारीख 25 ऑक्टोबर. महावितरण ॲपवर भरा.",
    "Hi beta, papa here. Don't tell mummy, I am planning a surprise for her birthday.",
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


def test_awareness_messages_do_not_raise_strong_signals():
    """Bank / police warnings use the scammers' words with a "never"; they must not trip the strong rules."""
    for text in ["पोलीस कधीही सुरक्षित खात्यात पैसे पाठवायला सांगत नाही.",
                 "डिजिटल अरेस्ट जैसा कुछ नहीं होता। पुलिस कभी भी सुरक्षित खाते में पैसे ट्रांसफर करने को नहीं कहती।",
                 "Beware: there is no such thing as digital arrest. Police never ask you to transfer money to a safe account.",
                 "पैसे पाने के लिए कभी भी QR स्कैन न करें या पिन न डालें - RBI"]:
        ids = {s.id for s in detect(text)}
        assert not ids & {"safe_account", "video_arrest", "upi_receive_trick"}, (text[:40], ids)
