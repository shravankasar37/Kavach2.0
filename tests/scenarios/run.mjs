// Kavach scenario acceptance suite: the 11 real-life situations Kavach must handle, driven end to end through the
// real app in Chrome (share sheet, screenshots, QR codes, uploaded and live calls) plus the API.
//
//   cd tests/scenarios && npm install && node run.mjs                       # local: web :3400, API :8000
//   WEB_URL=https://<app>.vercel.app API_URL=https://<api>.onrender.com node run.mjs   # deployed
//
// Writes docs/scenario-report.md and docs/scenario-report.json. A scenario PASSES only if every check passes;
// limits that no test can remove are written next to it, not hidden.
import { chromium } from "playwright-core";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const ASSETS = join(HERE, "assets");
const WEB = (process.env.WEB_URL || "http://localhost:3400").replace(/\/$/, "");
const API = (process.env.API_URL || "http://localhost:8000").replace(/\/$/, "");
const LOCAL = /localhost|127\.0\.0\.1/.test(API);
const CHROME = process.env.CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
const launch = (args = []) => chromium.launch({ headless: true, args, ...(CHROME && existsSync(CHROME) ? { executablePath: CHROME } : { channel: "chrome" }) });

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body, headers = {}) => {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const analyze = async (text) => (await post("/api/analyze", { text })).json;
const randomMobile = () => "9" + String(Math.floor(1e8 + Math.random() * 9e8));

async function scenario(id, title, notes, fn) {
  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
  const t0 = Date.now();
  try {
    await fn(check);
  } catch (e) {
    check("ran without errors", false, e.message);
  }
  const status = checks.length && checks.every((c) => c.ok) ? "PASS" : "FAIL";
  results.push({ id, title, status, seconds: Math.round((Date.now() - t0) / 1000), checks, notes });
  console.log(`${status}  ${id}. ${title}`);
  for (const c of checks) console.log(`   ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
}

async function appPage(browser, lang = "en") {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem("kavach-lang", l); } catch {}
    // record what "Read aloud" would say, instead of playing it
    window.__spoken = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 10); };
  }, lang);
  const page = await ctx.newPage();
  await page.goto(WEB);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("main")).visibility === "visible", null, { timeout: 15000 });
  return page;
}

// Android's share sheet sends a multipart POST to /share; the service worker turns it into a check
async function shareToKavach(page, { text = "", png = null }) {
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15000 });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.evaluate(async ({ text, b64 }) => {
    const f = document.createElement("form");
    f.method = "POST"; f.action = "/share"; f.enctype = "multipart/form-data";
    const t = document.createElement("input"); t.name = "text"; t.value = text; f.appendChild(t);
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const i = document.createElement("input"); i.type = "file"; i.name = "image";
      const dt = new DataTransfer(); dt.items.add(new File([bytes], "WhatsApp Image.png", { type: "image/png" })); i.files = dt.files; f.appendChild(i);
    }
    document.body.appendChild(f); f.submit();
  }, { text, b64: png ? png.toString("base64") : null });
  await page.waitForSelector("section[aria-live]", { timeout: 150000 });
  await sleep(300);
  return page.locator("section[aria-live]").first().innerText();
}

async function whatsappScreenshot(browser, message, sender = "Unknown +91 98xxx xxxxx") {
  const p = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0;background:#efe7dd;font-family:'Nirmala UI','Noto Sans Devanagari',sans-serif">
    <div style="background:#075e54;color:#fff;padding:12px 14px;font:600 15px sans-serif">${sender}</div>
    <div style="margin:14px;padding:10px 12px;background:#fff;border-radius:10px;font-size:16px;line-height:1.5;max-width:330px">${message}
    <div style="text-align:right;color:#999;font-size:11px">9:41 pm</div></div></body>`);
  const png = await p.screenshot();
  await p.close();
  return png;
}

function charAccuracy(expected, got) {
  const a = expected.replace(/\s/g, ""), b = got.replace(/\s/g, "");
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / a.length;
}

async function callGuardUpload(page, file) {
  const card = page.locator("section:has(ol)");
  await card.locator("input[type=file]").setInputFiles(file);
  await sleep(1500);
  for (let k = 0; k < 150; k++) {
    const top = (await card.innerText()).split(/Remember, on any call|याद रखें|लक्षात ठेवा/)[0];
    if (!/Checking|जाँच हो रही|तपासत आहे/.test(top)) break;
    await sleep(1000);
  }
  return card.innerText();
}

async function waitVoice(page, seconds = 90) {
  const card = page.locator("section:has(ol)");
  for (let k = 0; k < seconds; k++) {
    const line = (await card.innerText()).split("\n").find((l) => /(voice|आवाज़|आवाज).{0,60}(person|AI|इंसान|माणसा|उपलब्ध|available)/i.test(l) && l.length < 90);
    if (line) return line;
    await sleep(1000);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
const browser = await launch();
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
for (let k = 0; k < 60 && LOCAL && !(health?.phishing_lists?.urls > 0); k++) {
  await sleep(1000);
  Object.assign(health ?? {}, await fetch(`${API}/health`).then((r) => r.json()).catch(() => ({})));
}

await scenario(1, "Grandmother gets “Your electricity will be cut tonight, call 98xxx” SMS",
  "She doesn't need to copy-paste: long-press → Share → Kavach (installed app). The Telegram bot reply format is covered by backend/tests/test_telegram.py; a live bot needs a token from @BotFather.",
  async (check) => {
    const page = await appPage(browser, "hi");
    const sms = "Dear Consumer your electricity power will be disconnected tonight at 9.30 pm because your previous month bill was not updated. Please immediately contact our electricity officer 9876543210. Thank you.";
    const v = await shareToKavach(page, { text: sms });
    check("checked straight from the share sheet (no copy-paste)", true);
    check("verdict is high risk, in Hindi", v.includes("बहुत ज़्यादा खतरा"), v.split("\n").slice(0, 2).join(" | "));
    check("names the scam type in Hindi", v.includes("बिजली"), v.split("\n")[2]);
    await page.locator("section[aria-live] button").first().click();
    await sleep(300);
    const spoken = await page.evaluate(() => window.__spoken);
    check("“सुनें” reads the verdict aloud in Hindi (hi-IN)", spoken.length && spoken[0].lang === "hi-IN" && spoken[0].text.includes("खतरा"), spoken[0]?.text?.slice(0, 80));
    const installable = await page.evaluate(async () => { const m = await (await fetch("/manifest.webmanifest")).json(); return !!(m.share_target && m.display === "standalone"); });
    check("installable app that appears in Android's share menu", installable);
    await page.context().close();
  });

await scenario(2, "A screenshot of a scam forwarded on a family WhatsApp group",
  "OCR runs on the phone (Tesseract, English + Hindi + Marathi); the image never leaves the device.",
  async (check) => {
    const msg = "आपका बिजली कनेक्शन आज रात 9:30 बजे काट दिया जाएगा क्योंकि पिछले महीने का बिल अपडेट नहीं हुआ है। तुरंत बिजली अधिकारी से 9876543210 पर संपर्क करें।";
    const png = await whatsappScreenshot(browser, msg);
    const page = await appPage(browser, "hi");
    const v = await shareToKavach(page, { png });
    const read = await page.inputValue("#msg");
    const acc = charAccuracy(msg, read);
    check("screenshot shared into Kavach is read (OCR)", read.length > 40, read.slice(0, 60));
    check("Hindi text read with ≥ 90% character accuracy", acc >= 0.9, `${(acc * 100).toFixed(1)}%`);
    check("verdict is high risk", v.includes("बहुत ज़्यादा खतरा"), v.split("\n")[1]);
    await page.context().close();
    const mrMsg = "प्रिय ग्राहक, तुमचे वीज कनेक्शन आज रात्री 9:30 वाजता बंद केले जाईल. मागील महिन्याचे बिल अपडेट झालेले नाही. ताबडतोब वीज अधिकारी 9876543210 यांच्याशी संपर्क साधा.";
    const p2 = await appPage(browser, "mr");
    const v2 = await shareToKavach(p2, { png: await whatsappScreenshot(browser, mrMsg) });
    const acc2 = charAccuracy(mrMsg, await p2.inputValue("#msg"));
    check("Marathi screenshot read with ≥ 90% character accuracy", acc2 >= 0.9, `${(acc2 * 100).toFixed(1)}%`);
    check("Marathi verdict is high risk", v2.includes("खूप जास्त धोका"), v2.split("\n")[1]);
    await p2.context().close();
  });

await scenario(3, "Message with bit.ly/xyz",
  "Kavach reads only redirect headers; it never opens the page in a browser.",
  async (check) => {
    const v = await analyze("Your reward points expire today. Redeem now: https://bit.ly/3xyz");
    const l = v.links?.[0];
    check("the short link is followed to where it really goes", l?.redirected && l.final_domain && l.final_domain !== "bit.ly", l ? `${l.input} → ${l.final_domain}` : "no link result");
    check("the real destination's age and phishing-list status are shown", l && (l.domain_age_days !== null || l.official) && l.lists_loaded, l ? `age ${l.domain_age_days} days, listed ${l.phishing_listed}` : "");
    const page = await appPage(browser, "en");
    await page.fill("#msg", "Your reward points expire today. Redeem now: https://bit.ly/3xyz");
    await page.click("button.btn-primary");
    await page.waitForSelector("text=Really goes to", { timeout: 60000 }).catch(() => {});
    check("the app shows “Really goes to …”", (await page.locator("section[aria-live]").innerText()).includes("Really goes to"));
    await page.context().close();
  });

await scenario(4, "A new-looking link like secure-update-portal.in (no bank name in it)",
  "Uses the OpenPhish and URLhaus public feeds (refreshed every 3 h) and RDAP registration dates. A site that is brand new and not yet listed anywhere can still slip through; the AI model and the other signs are the backstop.",
  async (check) => {
    const feed = (await (await fetch("https://openphish.com/feed.txt")).text()).split("\n").map((s) => s.trim()).filter(Boolean);
    const live = feed.find((u) => { try { const h = new URL(u).hostname; return !/github|google|vercel|netlify|pages\.dev|workers\.dev|web\.app|firebase|blogspot|wix|weebly/.test(h); } catch { return false; } });
    const v = await analyze(`Dear customer, your account is on hold. Verify your details here: ${live}`);
    const ids = v.signals.map((s) => s.id);
    check("a link on today's phishing feed is caught as “known phishing”", ids.includes("phishing_listed"), live);
    check("…and the verdict is high risk", v.level === "high", `${v.level} ${v.risk}%`);
    const v2 = await analyze("Your account access is suspended due to unusual activity. Restore it within 24 hours at https://secure-update-portal.in/login");
    check("a no-brand phishing-style link is still flagged", v2.level !== "low", `${v2.level} ${v2.risk}% [${v2.signals.map((s) => s.id).join(", ")}]`);
    const l = v2.links?.[0];
    check("the link check reports whether the site exists / how old it is", l && (l.error || l.domain_age_days !== null), l ? (l.error ? `site: ${l.error}` : `age ${l.domain_age_days} days`) : "no link result");
  });

await scenario(5, "Scam fully in Marathi or Hindi",
  "The 22 test messages are written by the author from common scam patterns, not collected from real victims; real Hindi/Marathi accuracy will be measured from community reports. The model's measured accuracy is on the real English SMS test set (precision 0.992, recall 0.969).",
  async (check) => {
    const set = JSON.parse(readFileSync(join(ASSETS, "indic_messages.json"), "utf-8")).messages;
    let right = 0;
    const wrong = [];
    for (const m of set) {
      const v = await analyze(m.text);
      const ok = (v.level !== "low") === (m.label === "scam");
      right += ok;
      if (!ok) wrong.push(`${m.lang}/${m.label}→${v.level}: ${m.text.slice(0, 30)}`);
    }
    check(`all ${set.length} Hindi/Marathi messages classified correctly`, right === set.length, `${right}/${set.length}${wrong.length ? " · " + wrong.join(" · ") : ""}`);
    for (const [lang, word, english] of [["hi", "मैसेज जाँचें", "Check message"], ["mr", "संदेश तपासा", "Check message"]]) {
      const page = await appPage(browser, lang);
      const body = await page.locator("main").innerText();
      check(`interface fully in ${lang === "hi" ? "Hindi" : "Marathi"}`, body.includes(word) && !body.includes(english) && !body.includes("Paste the message"), body.split("\n").slice(2, 4).join(" | "));
      await page.context().close();
    }
  });

await scenario(6, "“Scan this QR to receive ₹5,000” / fake UPI collect request",
  "The QR is decoded on the phone. Kavach cannot see a collect request inside the UPI app itself, only messages, screenshots and QR images shared to it.",
  async (check) => {
    const page = await appPage(browser, "en");
    const qr = page.locator('section:has(h2:has-text("QR"))');
    await qr.locator("input[type=file]").setInputFiles(join(ASSETS, "qr_upi_refund_scam.png"));
    await page.waitForSelector("text=will SEND money", { timeout: 20000 }).catch(() => {});
    const t1 = await qr.innerText();
    check("a “refund” QR is decoded and shown as SENDING money", t1.includes("Scanning this QR will SEND money") && t1.includes("₹4999"), t1.split("\n").filter((l) => /SEND|Pays to|Amount/.test(l)).join(" | "));
    check("it warns the “SBI Refund” name hides a personal number", t1.includes("personal mobile number"));
    await qr.locator("input[type=file]").setInputFiles(join(ASSETS, "qr_upi_shop.png"));
    await sleep(1500);
    const t2 = await qr.innerText();
    check("a normal shop QR is explained without a scam alarm", t2.includes("Sharma Kirana") && !t2.includes("⚠"), t2.split("\n").filter((l) => /SEND|Pays to/.test(l)).join(" | "));
    await page.context().close();
    const v = await analyze("Congratulations! You have received a cashback of Rs 5,000 from PhonePe. Scan the QR code and enter your UPI PIN to receive the money in your account.");
    check("“scan / enter PIN to receive money” text is high risk", v.level === "high" && v.signals.some((s) => s.id === "upi_receive_trick"), `${v.level} ${v.risk}%`);
    const v2 = await analyze("PhonePe: Never enter your UPI PIN to receive money. Scanning a QR is only for paying.");
    check("a genuine “never enter your PIN to receive” warning is not flagged", v2.level === "low", `${v2.level} ${v2.risk}%`);
  });

await scenario(7, "Live “digital arrest” video call happening right now",
  "Android does not let apps record the call line, so Call Guard listens on speaker through the microphone (or a second phone held nearby, or a recording afterwards). It hears the caller's words, not the video. Voice check: VaaniShield (EER 2.66% in-domain, 10.36% cross-domain). All test voices here are synthetic, so 'AI voice' is the correct result for them; a real human recording could not be tested automatically.",
  async (check) => {
    const page = await appPage(browser, "hi");
    const t = await callGuardUpload(page, join(ASSETS, "call_digital_arrest_hi.mp3"));
    check("Hindi digital-arrest call recording → “अभी फ़ोन काट दें”", t.includes("अभी फ़ोन काट दें"), t.split("\n").find((l) => l.startsWith("डिजिटल अरेस्ट /")) ?? "");
    const voice = await waitVoice(page);
    check("voice-clone check answers (synthetic test voice → flagged as AI)", voice && /AI/.test(voice), voice ?? "no answer in 90 s");
    await page.context().close();
    const pm = await appPage(browser, "mr");
    const tm = await callGuardUpload(pm, join(ASSETS, "call_digital_arrest_mr.mp3"));
    check("Marathi digital-arrest call → “आत्ताच फोन ठेवा”", tm.includes("आत्ताच फोन ठेवा"), tm.split("\n").find((l) => l.startsWith("डिजिटल अरेस्ट /")) ?? "");
    await pm.context().close();
    const pf = await appPage(browser, "en");
    const tf = await callGuardUpload(pf, join(ASSETS, "call_family_en.mp3"));
    check("a normal family call is not flagged", tf.includes("Looks safe"), tf.split("\n").find((l) => /Looks safe|Be careful|Hang up/.test(l)) ?? "");
    // live: convert the English call to WAV and feed it to Chrome as the microphone (speakerphone simulation)
    const wavB64 = await pf.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new AudioContext(); const dec = await ctx.decodeAudioData(bytes.buffer); ctx.close();
      const off = new OfflineAudioContext(1, Math.ceil(dec.duration * 16000), 16000); const s = off.createBufferSource(); s.buffer = dec; s.connect(off.destination); s.start();
      const pcm = (await off.startRendering()).getChannelData(0);
      const dv = new DataView(new ArrayBuffer(44 + pcm.length * 2)); const w = (o, t) => [...t].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
      w(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, pcm.length * 2, true);
      for (let k = 0; k < pcm.length; k++) dv.setInt16(44 + k * 2, Math.max(-1, Math.min(1, pcm[k])) * 0x7fff, true);
      let bin = ""; const u8 = new Uint8Array(dv.buffer); for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode(...u8.subarray(k, k + 0x8000));
      return btoa(bin);
    }, readFileSync(join(ASSETS, "call_digital_arrest_en.mp3")).toString("base64"));
    await pf.context().close();
    const wav = join(mkdtempSync(join(tmpdir(), "kavach-")), "mic.wav");
    writeFileSync(wav, Buffer.from(wavB64, "base64"));
    const liveBrowser = await launch(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`]);
    const pl = await appPage(liveBrowser, "en");
    const card = pl.locator("section:has(ol)");
    const t0 = Date.now();
    await card.locator('button:has-text("Start listening")').click();
    let alarm = false;
    for (let k = 0; k < 75 && !alarm; k++) { await sleep(1000); alarm = (await card.innerText()).includes("Hang up now"); }
    const secs = Math.round((Date.now() - t0) / 1000);
    check("live listening on speaker raises “Hang up now” within 60 s", alarm && secs <= 60, `${secs} s`);
    await card.locator('button:has-text("Stop")').click().catch(() => {});
    await liveBrowser.close();
  });

await scenario(8, "Victim lost ₹12,000 two hours ago",
  "Steps follow the I4C/RBI process (call 1930 within the 'golden hour', RBI's zero/limited liability circular). The incident text is drafted by an LLM and then fact-checked against what the user entered.",
  async (check) => {
    const t0 = Date.now();
    const r = await fetch(`${WEB}/api/recover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      message: "Dear customer your SBI KYC is pending. Update now: http://sbi-kyc-verify.top/login", story: "I clicked the link, entered my card details and an OTP. 12000 rupees were debited by UPI.",
      category: "Fake KYC update", lang: "hi",
      facts: { lostMoney: true, amount: 12000, hoursAgo: 2, paidVia: "upi", sharedOtpOrPin: true, installedApp: false, bank: "SBI" } }) });
    const j = await r.json();
    const secs = (Date.now() - t0) / 1000;
    check("first step is calling 1930 now, marked urgent, in Hindi", j.steps?.[0]?.urgent && /1930/.test(j.steps[0].title + j.steps[0].detail) && /[\u0900-\u097F]/.test(j.steps[0].title), j.steps?.[0]?.title);
    check("bank dispute letter is ready, citing the RBI circular and the amount", j.letter && j.letter.includes("DBR.No.Leg.BC.78") && /12,000|12000/.test(j.letter));
    const amounts = (j.narrative?.incident.match(/(?:₹|Rs\.?|INR)\s?[\d,]+/gi) ?? []).map((a) => a.replace(/\D/g, ""));
    check("incident report drafted, without invented amounts", j.narrative && amounts.every((a) => a === "12000"), j.narrative ? j.narrative.incident.slice(0, 120) : j.note);
    check("everything ready in under 45 s", secs < 45, `${secs.toFixed(1)} s`);
  });

await scenario(9, "“Is this phone number a scammer?”",
  "A number counts as reported only after 3 different people report it, so one person cannot blacklist someone else; numbers are stored only as salted hashes. On the deployed app, distinct reporters can't be simulated, so the 3-reporter step runs only locally.",
  async (check) => {
    const num = randomMobile();
    const msg = `Your electricity will be cut tonight. Call officer ${num} immediately.`;
    const reporters = LOCAL ? ["10.20.0.1", "10.20.0.2", "10.20.0.3"] : [null];
    for (const ip of reporters) {
      const r = await post("/api/report", { items: [{ kind: "phone", value: num }], category: "Fake electricity disconnection", text: msg, lang: "en" }, ip ? { "X-Forwarded-For": ip } : {});
      check(`report saved${ip ? ` (reporter ${ip})` : ""}`, r.status === 200 && r.json.saved === 1, r.status);
    }
    const look = await (await fetch(`${API}/api/lookup?kind=phone&value=${num}`)).json();
    check("lookup shows the number, masked", look.hint === `XXXXXX${num.slice(-4)}`, look.hint);
    if (LOCAL) {
      check("after 3 different reporters the number is flagged", look.flagged && look.reporters === 3, `${look.reporters} reporters`);
      const v = await analyze(msg);
      check("the next person who gets a message from it is warned", v.signals.some((s) => s.id === "reported_by_users"), v.signals.map((s) => s.id).join(", "));
    } else {
      check("lookup counts the report", look.reporters >= 1, `${look.reporters} reporters`);
    }
    const page = await appPage(browser, "en");
    await page.fill('input[placeholder*="98765"]', num);
    await page.click('section:has(h2:has-text("Check a number")) button');
    await page.waitForSelector(`text=XXXXXX${num.slice(-4)}`, { timeout: 20000 }).catch(() => {});
    check("the lookup box in the app answers", (await page.locator('section:has(h2:has-text("Check a number"))').innerText()).includes(`XXXXXX${num.slice(-4)}`));
    await page.context().close();
  });

await scenario(10, "A brand-new scam script next month",
  "Two loops: (1) instant: reported numbers, UPI IDs and websites warn everyone immediately; (2) slower: scripts/export_reports.py turns reports confirmed by 3+ people into training rows for the next Kaggle fine-tune. The model is not retrained automatically.",
  async (check) => {
    const novel = [
      "FASTag alert: your FASTag KYC has expired and your tag will be blacklisted at midnight. Update KYC now to avoid a Rs 500 penalty: fastag-kyc-renew.online",
      "TRAI notice: your mobile number will be disconnected in 2 hours due to illegal activity. Press 9 to speak to the TRAI officer.",
      "Your PM Kisan installment of Rs 6000 is on hold. Download the PM Kisan update APK from the link below to receive it.",
    ];
    for (const n of novel) {
      const v = await analyze(n);
      check(`unseen script flagged: “${n.slice(0, 38)}…”`, v.level !== "low", `${v.level} ${v.risk}%`);
    }
    if (LOCAL) {
      const site = `kyc-${Math.floor(Math.random() * 1e6)}-help.top`;
      for (const ip of ["10.30.0.1", "10.30.0.2", "10.30.0.3"]) await post("/api/report", { items: [{ kind: "domain", value: site }], category: "Fake KYC update", text: `Update KYC at ${site}`, lang: "en" }, { "X-Forwarded-For": ip });
      const tr = await (await fetch(`${API}/api/trending`)).json();
      check("a site reported by 3 people appears in “Scams people are checking this week”", tr.domains.some((d) => d.domain === site), tr.domains.map((d) => d.domain).join(", "));
    }
  });

await scenario(11, "User opens the site after it has been idle",
  "Render's free tier sleeps after 15 idle minutes; the 750 free hours a month are shared by all free services, so the API is kept awake only 06:30–23:30 IST (GitHub Actions). Outside those hours the first check can take ~50 s; the app wakes the API the moment it opens and says it is waking.",
  async (check) => {
    check("keep-alive schedule exists (06:30–23:30 IST)", existsSync(join(ROOT, ".github", "workflows", "keep-alive.yml")));
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let woke = false;
    page.on("request", (r) => { if (r.url().startsWith(`${API}/health`)) woke = true; });
    await page.goto(WEB);
    await sleep(1500);
    check("opening the app immediately wakes the API", woke);
    const t0 = Date.now();
    const h = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
    check("API answering", h, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const t1 = Date.now();
    await page.fill("#msg", "Your SBI account will be blocked today. Update KYC: sbi-kyc.top");
    await page.click("button.btn-primary");
    await page.waitForSelector("section[aria-live]", { timeout: 120000 });
    const secs = (Date.now() - t1) / 1000;
    check("verdict shown within 10 s once the API is awake", secs < 10, `${secs.toFixed(1)} s`);
    await ctx.close();
  });

await browser.close();

// ---------------------------------------------------------------------------------------------------------------
const passed = results.filter((r) => r.status === "PASS").length;
const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
const md = [
  "# Kavach scenario report",
  "",
  `Run ${when} against \`${WEB}\` (web) and \`${API}\` (API). **${passed}/${results.length} scenarios pass.**`,
  "",
  "Generated by `tests/scenarios/run.mjs`, which drives the real app in Chrome: Android's share sheet (Web Share Target), WhatsApp-style screenshots, QR images, uploaded call recordings and a simulated speakerphone microphone. Every check below ran; nothing is hand-edited.",
  "",
  "| # | Scenario | Result | Time |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.title} | ${r.status === "PASS" ? "✅ PASS" : "❌ FAIL"} | ${r.seconds} s |`),
  "",
  ...results.flatMap((r) => [
    `## ${r.id}. ${r.title} — ${r.status}`,
    "",
    ...r.checks.map((c) => `- ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail.replace(/\|/g, "/")}` : ""}`),
    "",
    `_Limits:_ ${r.notes}`,
    "",
  ]),
].join("\n");
writeFileSync(join(ROOT, "docs", "scenario-report.md"), md);
writeFileSync(join(ROOT, "docs", "scenario-report.json"), JSON.stringify({ when, web: WEB, api: API, passed, total: results.length, results }, null, 1));
console.log(`\n${passed}/${results.length} scenarios pass → docs/scenario-report.md`);
process.exit(passed === results.length ? 0 : 1);
