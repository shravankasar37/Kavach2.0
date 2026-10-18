"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Step } from "@/lib/recovery";
import { categoryText, LANGS, LEVEL_TEXT, signalText, t, type Lang } from "@/lib/i18n";
import { decodeQr, explainQr, type QrResult } from "@/lib/qr";
import { LookupCard, ReportCard, TrendingCard, type Known } from "@/components/Community";
import CallGuard from "@/components/CallGuard";

const API = (process.env.NEXT_PUBLIC_KAVACH_API || "http://localhost:8000").replace(/\/$/, "");

type Signal = { id: string; label: string; weight: number; evidence: string };
type LinkResult = { input: string; final_url: string; redirected: boolean; final_domain: string | null; domain_age_days: number | null; phishing_listed: boolean; official: boolean; error: string | null; lists_loaded: boolean };
type Verdict = { risk: number; level: "high" | "medium" | "low"; category: string | null; model_probability: number; signal_score: number; signals: Signal[]; links?: LinkResult[]; known?: Known[]; ms: number };

function LinkCard({ r, L }: { r: LinkResult; L: (k: string) => string }) {
  const bad = r.phishing_listed || (r.domain_age_days !== null && r.domain_age_days < 90 && !r.official);
  const age = r.domain_age_days === null ? L("ageUnknown")
    : r.domain_age_days < 365 ? L("ageDays").replace("{n}", String(r.domain_age_days))
    : L("ageYears").replace("{n}", String(Math.floor(r.domain_age_days / 365)));
  return (
    <li className="rounded-xl border p-3 text-sm" style={{ borderColor: bad ? "var(--red)" : "var(--line)" }}>
      <div className="break-all font-medium">{r.input}</div>
      {r.redirected && <div className="mt-1 break-all">{L("goesTo")}: <b>{r.final_domain}</b></div>}
      {r.official ? <div className="mt-1" style={{ color: "var(--green)" }}>✓ {L("official")}</div> : (
        <>
          {r.error ? <div className="mt-1" style={{ color: "var(--amber)" }}>{L("noSite")}</div>
            : <div className="mt-1" style={{ color: r.domain_age_days !== null && r.domain_age_days < 90 ? "var(--red)" : "var(--muted)" }}>{age}</div>}
          {r.lists_loaded && <div className="mt-1" style={{ color: r.phishing_listed ? "var(--red)" : "var(--muted)" }}>{r.phishing_listed ? `⚠ ${L("onList")}` : L("notOnList")}</div>}
        </>
      )}
    </li>
  );
}

function QrCard({ q, L, link }: { q: QrResult; L: (k: string) => string; link: LinkResult | null }) {
  if (q.kind === "none") return <p className="mt-3 text-sm" style={{ color: "var(--amber)" }}>{L("qrNone")}</p>;
  if (q.kind === "upi")
    return (
      <div className="mt-3 overflow-hidden rounded-xl" style={{ border: `2px solid ${q.suspicious ? "var(--red)" : "var(--blue)"}` }}>
        <div className="p-3 font-bold" style={{ background: q.suspicious ? "var(--red)" : "var(--blue)", color: "#fff" }}>{q.suspicious ? "⚠ " : ""}{L("qrPay")}</div>
        <div className="space-y-1 p-3 text-sm" style={{ background: q.suspicious ? "var(--red-soft)" : "var(--blue-soft)" }}>
          <div>{L("qrTo")}: <b className="break-all">{q.pn ? `${q.pn} · ` : ""}{q.pa}</b></div>
          <div>{L("qrAmount")}: <b>{q.am ? `₹${q.am}` : L("qrAnyAmount")}</b></div>
          {q.tn && <div className="break-all">“{q.tn}”</div>}
          {q.personalVpa && q.nameLooksBusiness && <div className="font-semibold" style={{ color: "var(--red)" }}>{L("qrMismatch").replace("{pn}", q.pn ?? "")}</div>}
          <div className="pt-1 font-medium">{L("qrRule")}</div>
        </div>
      </div>
    );
  return (
    <div className="mt-3 text-sm">
      <div className="font-semibold">{q.kind === "link" ? L("qrLink") : L("qrText")}</div>
      {q.kind === "link" && link ? <ul className="mt-2"><LinkCard r={link} L={L} /></ul> : <div className="mt-1 break-all">{q.raw}</div>}
    </div>
  );
}
type Recovery = { steps: Step[]; letter: string | null; narrative: { incident: string; missing: string[] } | null; note?: string };
type InstallEvent = Event & { prompt: () => Promise<void> };

const SAMPLES: { key: string; text: string }[] = [
  { key: "sampleKyc", text: "Dear customer your SBI account will be blocked today. Update your KYC now: http://sbi-kyc-verify.top/login" },
  { key: "sampleBijli", text: "आपका बिजली कनेक्शन आज रात 9:30 बजे काट दिया जाएगा। पिछला बिल अपडेट नहीं है। तुरंत 9876543210 पर संपर्क करें।" },
  { key: "sampleParcel", text: "India Post: Your package has arrived at the warehouse and we attempted delivery twice but were unable due to incomplete address. Please update your address within 48 hours: indiapost-go-in.one/index" },
  { key: "sampleJob", text: "Part time job! Earn Rs 3000 per day by liking YouTube videos. No investment. WhatsApp 9123456780 to join." },
  { key: "sampleGenuine", text: "Rs.500.00 debited from A/c XX1234 on 17-10-26 to VPA shop@okaxis (UPI Ref 629173548211). Not you? Call 1800 1234 from SBI." },
];

const COLORS = {
  high: { bg: "var(--red)", soft: "var(--red-soft)" },
  medium: { bg: "var(--amber)", soft: "var(--amber-soft)" },
  low: { bg: "var(--green)", soft: "var(--green-soft)" },
} as const;

function Shield() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3Z" fill="var(--blue)" />
      <path d="m8.5 12 2.3 2.3L15.8 9.3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** On-device OCR (Tesseract.js, English + Hindi + Marathi); the image never leaves the phone. */
async function readImage(file: Blob, onProgress: (p: number) => void): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  let fail: (e: unknown) => void = () => {};
  // worker errors (e.g. an unreadable image) arrive here, not as a rejected promise
  const failed = new Promise<never>((_, reject) => (fail = reject));
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ocr timeout")), 120_000));
  failed.catch(() => {});
  timeout.catch(() => {});
  const worker = await Promise.race([
    createWorker(["eng", "hin", "mar"], 1, {
      logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && onProgress(m.progress),
      errorHandler: (e: unknown) => fail(e),
    }),
    failed,
    timeout,
  ]);
  try {
    const { data } = await Promise.race([worker.recognize(file), failed, timeout]);
    return data.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    worker.terminate().catch(() => {});
  }
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  // the page is pre-rendered in English; stay invisible until the saved language is applied (no English flash)
  const [langReady, setLangReady] = useState(false);
  const L = (k: string) => t(lang, k);
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [ocr, setOcr] = useState<{ active: boolean; progress: number; done: boolean }>({ active: false, progress: 0, done: false });
  const [speaking, setSpeaking] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const [lost, setLost] = useState(false);
  const [story, setStory] = useState("");
  const [amount, setAmount] = useState("");
  const [hours, setHours] = useState("");
  const [paidVia, setPaidVia] = useState("upi");
  const [bank, setBank] = useState("");
  const [otp, setOtp] = useState(false);
  const [app, setApp] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [qr, setQr] = useState<QrResult | null>(null);
  const [qrLink, setQrLink] = useState<LinkResult | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const verdictRef = useRef<HTMLElement>(null);

  // language: saved choice, else the phone's language
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("kavach-lang");
    } catch {}
    const nav = navigator.language.slice(0, 2);
    setLang((saved as Lang) || (nav === "hi" || nav === "mr" ? nav : "en"));
    setLangReady(true);
  }, []);
  const chooseLang = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem("kavach-lang", l);
    } catch {}
  };

  // wake the free-tier API as soon as the app opens, so it is ready by the time a message is pasted
  useEffect(() => {
    fetch(`${API}/health`).catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const check = useCallback(
    async (msg?: string) => {
      const body = (msg ?? text).trim();
      if (body.length < 3) return;
      setBusy(true);
      setSlow(false);
      setError("");
      setVerdict(null);
      setRecovery(null);
      const slowTimer = setTimeout(() => setSlow(true), 4000);
      try {
        let r: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            r = await fetch(`${API}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) });
            if (r.status !== 503 && r.status !== 502) break;
          } catch {
            r = null;
          }
          await new Promise((res) => setTimeout(res, 8000)); // free tier waking up
        }
        if (!r || !r.ok) throw new Error();
        setVerdict(await r.json());
        setTimeout(() => verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      } catch {
        setError(L("unreachable"));
      } finally {
        clearTimeout(slowTimer);
        setBusy(false);
        setSlow(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, lang],
  );

  async function onImage(file: Blob, autoCheck = false) {
    setOcr({ active: true, progress: 0, done: false });
    setError("");
    // a screenshot may hold a payment QR: explain it too
    decodeQr(file).then((raw) => { if (raw) checkQr(file); }).catch(() => {});
    try {
      const read = await readImage(file, (p) => setOcr({ active: true, progress: p, done: false }));
      if (read.length < 3) throw new Error("no text");
      setText(read);
      setOcr({ active: false, progress: 1, done: true });
      if (autoCheck) check(read);
    } catch {
      setOcr({ active: false, progress: 0, done: false });
      setError(L("ocrFail"));
    }
  }

  // "Share to Kavach": pick up what the service worker stored (or the URL-hash fallback) and check it
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("shared")) return;
    (async () => {
      const hashText = new URLSearchParams(location.hash.slice(1)).get("text");
      let sharedText = hashText ?? "";
      let image: Blob | null = null;
      try {
        const cache = await caches.open("kavach-share");
        sharedText = sharedText || (await (await cache.match("/shared/text"))?.text()) || "";
        image = (await (await cache.match("/shared/image"))?.blob()) ?? null;
        await cache.delete("/shared/text");
        await cache.delete("/shared/image");
      } catch {}
      history.replaceState(null, "", "/");
      if (image) await onImage(image, !sharedText);
      if (sharedText) {
        setText(sharedText);
        check(sharedText);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function speak() {
    if (!verdict) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const code = LANGS.find((x) => x.id === lang)!.speech;
    const lv = LEVEL_TEXT[lang][verdict.level];
    const reasons = verdict.signals.slice(0, 3).map((s) => signalText(lang, s.id, s.label));
    const sentence = [`${lv.title}.`, categoryText(lang, verdict.category) ?? "", ...reasons, lv.sub].filter(Boolean).join(". ");
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = code;
    const v = synth.getVoices().find((x) => x.lang.replace("_", "-").toLowerCase().startsWith(code.slice(0, 2)));
    if (v) u.voice = v;
    setNoVoice(!v && lang !== "en");
    u.rate = 0.9; // a little slower for older listeners
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  async function recover() {
    setRecBusy(true);
    try {
      const r = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          story,
          category: verdict?.category ?? null,
          lang,
          facts: { lostMoney: lost, amount: amount ? Number(amount) : null, hoursAgo: hours ? Number(hours) : null, paidVia, sharedOtpOrPin: otp, installedApp: app, bank: bank || null },
        }),
      });
      setRecovery(await r.json());
    } finally {
      setRecBusy(false);
    }
  }

  async function checkQr(file: Blob) {
    setQrBusy(true);
    setQr(null);
    setQrLink(null);
    try {
      const raw = await decodeQr(file);
      const q: QrResult = raw ? explainQr(raw) : { kind: "none" };
      setQr(q);
      if (q.kind === "link") {
        const r = await fetch(`${API}/api/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: q.raw }) });
        if (r.ok) setQrLink(await r.json());
      }
    } catch {
      setQr({ kind: "none" });
    } finally {
      setQrBusy(false);
    }
  }

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  };

  const C = verdict ? COLORS[verdict.level] : null;
  const LV = verdict ? LEVEL_TEXT[lang][verdict.level] : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6" lang={lang} style={{ visibility: langReady ? "visible" : "hidden" }}>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <Shield />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Kavach <span className="font-semibold" style={{ color: "var(--muted)" }}>कवच</span></h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{L("tagline")}</p>
        </div>
        <div role="radiogroup" aria-label="Language" className="flex overflow-hidden rounded-xl border" style={{ borderColor: "var(--line)" }}>
          {LANGS.map((x) => (
            <button key={x.id} role="radio" aria-checked={lang === x.id} onClick={() => chooseLang(x.id)} className="px-3 py-2 text-sm font-semibold"
              style={{ background: lang === x.id ? "var(--blue)" : "var(--surface)", color: lang === x.id ? "#fff" : "var(--ink)" }}>
              {x.label}
            </button>
          ))}
        </div>
      </header>

      {installEvt && (
        <button onClick={() => installEvt.prompt().then(() => setInstallEvt(null))} className="card mb-4 flex w-full items-center gap-3 p-4 text-left" style={{ borderColor: "var(--blue)" }}>
          <Shield />
          <span><span className="block font-semibold">{L("install")}</span><span className="text-sm" style={{ color: "var(--muted)" }}>{L("installHint")}</span></span>
        </button>
      )}

      <section className="card p-5">
        <label htmlFor="msg" className="mb-2 block font-semibold">{L("paste")}</label>
        <textarea id="msg" className="field min-h-[130px] text-[16px]" value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} placeholder={L("placeholder")} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ color: "var(--muted)" }}>{L("or")}</span>
          <label className="btn-ghost cursor-pointer text-sm">
            📷 {L("screenshot")}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
          </label>
          {ocr.active && <span className="text-sm">{L("reading")} {Math.round(ocr.progress * 100)}%</span>}
          {ocr.done && !busy && !verdict && <span className="text-sm" style={{ color: "var(--green)" }}>{L("readDone")}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLES.map((s) => <button key={s.key} className="chip" onClick={() => setText(s.text)}>{L(s.key)}</button>)}
        </div>
        <button className="btn-primary mt-4 w-full text-[17px]" disabled={busy || ocr.active || text.trim().length < 3} onClick={() => check()}>
          {busy ? L("checking") : L("check")}
        </button>
        {slow && <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{L("waking")}</p>}
        {error && <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>{error}</p>}
      </section>

      {verdict && C && LV && (
        <section ref={verdictRef} className="mt-5 overflow-hidden rounded-2xl" style={{ border: `2px solid ${C.bg}` }} aria-live="polite">
          <div className="flex flex-wrap items-center gap-4 p-5" style={{ background: C.bg, color: "#fff" }}>
            <div className="text-5xl font-extrabold leading-none">{Math.round(verdict.risk)}%</div>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold">{LV.title}</div>
              <div className="text-sm opacity-95">{verdict.category ? `${categoryText(lang, verdict.category)} · ` : ""}{LV.sub}</div>
            </div>
            <button onClick={speak} className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }} aria-label={L("listen")}>
              🔊 {speaking ? L("stop") : L("listen")}
            </button>
          </div>
          <div className="p-5" style={{ background: "var(--surface)" }}>
            {noVoice && <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>{L("noVoice")}</p>}
            {verdict.signals.length > 0 ? (
              <>
                <h2 className="mb-2 font-semibold">{L("why")}</h2>
                <ul className="space-y-2">
                  {verdict.signals.map((s) => (
                    <li key={s.id} className="flex gap-3 rounded-xl p-3" style={{ background: C.soft }}>
                      <span aria-hidden className="mt-0.5 font-bold" style={{ color: C.bg }}>!</span>
                      <div>
                        <div className="font-medium">{signalText(lang, s.id, s.label)}</div>
                        {s.evidence && <div className="text-sm" style={{ color: "var(--muted)" }}>{L("found")}: “{s.evidence}”</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p style={{ color: "var(--muted)" }}>{L("noSigns")}</p>
            )}
            {!!verdict.links?.length && (
              <>
                <h2 className="mb-2 mt-4 font-semibold">{L("linkCheck")}</h2>
                <ul className="space-y-2">{verdict.links.map((r) => <LinkCard key={r.input} r={r} L={L} />)}</ul>
              </>
            )}
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              AI {verdict.model_probability}% · signs {verdict.signal_score}% · {verdict.ms} ms. {L("canBeWrong")}
            </p>
            {verdict.level !== "low" && (
              <ReportCard key={`${verdict.ms}-${text.length}`} api={API} known={verdict.known ?? []} category={verdict.category} text={text} lang={lang} L={L} />
            )}
          </div>
        </section>
      )}

      {verdict && (
        <section className="card mt-5 p-5">
          <label className="flex items-center gap-3 font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={lost} onChange={(e) => setLost(e.target.checked)} />
            {L("lost")}
          </label>
          {lost && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <textarea className="field sm:col-span-2" rows={3} value={story} onChange={(e) => setStory(e.target.value)} placeholder={L("whatHappened")} />
              <input className="field" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder={L("amount")} aria-label={L("amount")} />
              <input className="field" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ""))} placeholder={L("hours")} aria-label={L("hours")} />
              <select className="field" value={paidVia} onChange={(e) => setPaidVia(e.target.value)} aria-label="Paid via">
                <option value="upi">UPI</option><option value="card">Debit / credit card</option><option value="netbanking">Net banking</option><option value="wallet">Wallet</option><option value="other">Other</option>
              </select>
              <input className="field" value={bank} onChange={(e) => setBank(e.target.value)} placeholder={L("bank")} aria-label={L("bank")} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={otp} onChange={(e) => setOtp(e.target.checked)} /> {L("sharedOtp")}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={app} onChange={(e) => setApp(e.target.checked)} /> {L("installedApp")}</label>
            </div>
          )}
          <button className="btn-primary mt-4" onClick={recover} disabled={recBusy}>{recBusy ? L("preparing") : lost ? L("getPlan") : L("whatToDo")}</button>

          {recovery && (
            <div className="mt-5 space-y-3">
              {recovery.steps.map((s, i) => (
                <div key={s.id} className="rounded-xl p-4" style={{ background: s.urgent ? "var(--red-soft)" : "var(--blue-soft)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">{i + 1}. {s.title}</div>
                    {s.action && <a href={s.action.href} target={s.action.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="btn-ghost text-sm">{s.action.label}</a>}
                  </div>
                  <p className="mt-1 text-sm">{s.detail}</p>
                </div>
              ))}
              {(recovery.narrative || recovery.letter) && <p className="text-xs" style={{ color: "var(--muted)" }}>{L("englishDocs")}</p>}
              {recovery.narrative && (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
                  <div className="mb-2 flex items-center justify-between gap-2"><span className="font-semibold">{L("incident")}</span>
                    <button className="btn-ghost text-sm" onClick={() => copy("n", recovery.narrative!.incident)}>{copied === "n" ? L("copied") : L("copy")}</button></div>
                  <p className="whitespace-pre-wrap text-sm" lang="en">{recovery.narrative.incident}</p>
                  {recovery.narrative.missing.length > 0 && <p className="mt-2 text-xs" style={{ color: "var(--amber)" }}>{L("addBefore")}: {recovery.narrative.missing.join(", ")}</p>}
                </div>
              )}
              {recovery.letter && (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
                  <div className="mb-2 flex items-center justify-between gap-2"><span className="font-semibold">{L("letter")}</span>
                    <button className="btn-ghost text-sm" onClick={() => copy("l", recovery.letter!)}>{copied === "l" ? L("copied") : L("copy")}</button></div>
                  <pre className="whitespace-pre-wrap font-sans text-sm" lang="en">{recovery.letter}</pre>
                </div>
              )}
              {recovery.note && <p className="text-sm" style={{ color: "var(--amber)" }}>{recovery.note}</p>}
            </div>
          )}
        </section>
      )}

      <section className="card mt-5 p-5">
        <h2 className="font-semibold">{L("qrTitle")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{L("qrBody")}</p>
        <label className="btn-ghost mt-3 inline-block cursor-pointer text-sm">
          ▣ {L("qrPick")}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) checkQr(e.target.files[0]); e.target.value = ""; }} />
        </label>
        {qrBusy && <p className="mt-2 text-sm">{L("checking")}</p>}
        {qr && <QrCard q={qr} L={L} link={qrLink} />}
      </section>

      <LookupCard api={API} L={L} />

      <CallGuard api={API} lang={lang} L={L} />

      <TrendingCard api={API} lang={lang} L={L} />

      <footer className="mt-8 text-center text-xs" style={{ color: "var(--muted)" }}>{L("footer")}</footer>
    </main>
  );
}
