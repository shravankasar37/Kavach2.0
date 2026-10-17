"use client";

import { useState } from "react";
import type { Step } from "@/lib/recovery";

const API = (process.env.NEXT_PUBLIC_KAVACH_API || "http://localhost:8000").replace(/\/$/, "");
const VAANI = "https://vaanishield-api.onrender.com";

type Signal = { id: string; label: string; weight: number; evidence: string };
type Verdict = { risk: number; level: "high" | "medium" | "low"; category: string | null; model_probability: number; signal_score: number; signals: Signal[]; ms: number };
type Recovery = { steps: Step[]; letter: string | null; narrative: { incident: string; missing: string[] } | null; note?: string };

const SAMPLES = [
  { label: "KYC block", text: "Dear customer your SBI account will be blocked today. Update your KYC now: http://sbi-kyc-verify.top/login" },
  { label: "बिजली कनेक्शन", text: "आपका बिजली कनेक्शन आज रात 9:30 बजे काट दिया जाएगा। पिछला बिल अपडेट नहीं है। तुरंत 9876543210 पर संपर्क करें।" },
  { label: "India Post", text: "India Post: Your package has arrived at the warehouse and we attempted delivery twice but were unable due to incomplete address. Please update your address within 48 hours: indiapost-go-in.one/index" },
  { label: "Job offer", text: "Part time job! Earn Rs 3000 per day by liking YouTube videos. No investment. WhatsApp 9123456780 to join." },
  { label: "Genuine bank alert", text: "Rs.500.00 debited from A/c XX1234 on 17-10-26 to VPA shop@okaxis (UPI Ref 629173548211). Not you? Call 1800 1234 from SBI." },
];

const LEVEL = {
  high: { title: "High risk: this looks like a scam", sub: "Don't click, call back, pay or share any OTP.", bg: "var(--red)", soft: "var(--red-soft)", fg: "#fff" },
  medium: { title: "Be careful", sub: "Some warning signs. Check with the company through its official app or number.", bg: "var(--amber)", soft: "var(--amber-soft)", fg: "#fff" },
  low: { title: "Looks safe", sub: "No common scam signs. Still never share OTPs or PINs with anyone.", bg: "var(--green)", soft: "var(--green-soft)", fg: "#fff" },
} as const;

function Shield() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3Z" fill="var(--blue)" />
      <path d="m8.5 12 2.3 2.3L15.8 9.3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const [voice, setVoice] = useState<{ risk: number; label: string } | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError("");
    setVerdict(null);
    setRecovery(null);
    try {
      const r = await fetch(`${API}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error(r.status === 503 ? "The checker is starting up. Try again in a minute." : `Check failed (${r.status})`);
      setVerdict(await r.json());
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't reach the checker. On the free plan it may take up to a minute to wake up; try again.");
    } finally {
      setBusy(false);
    }
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
          facts: { lostMoney: lost, amount: amount ? Number(amount) : null, hoursAgo: hours ? Number(hours) : null, paidVia, sharedOtpOrPin: otp, installedApp: app, bank: bank || null },
        }),
      });
      setRecovery(await r.json());
    } finally {
      setRecBusy(false);
    }
  }

  async function checkVoice(file: File) {
    setVoiceBusy(true);
    setVoice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${VAANI}/api/analyze-file`, { method: "POST", body: fd });
      const j = await r.json();
      setVoice({ risk: j.risk_score, label: j.label });
    } catch {
      setVoice({ risk: -1, label: "Couldn't reach VaaniShield; try again in a minute." });
    } finally {
      setVoiceBusy(false);
    }
  }

  const L = verdict ? LEVEL[verdict.level] : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Shield />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kavach <span className="font-semibold" style={{ color: "var(--muted)" }}>कवच</span></h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Check a suspicious SMS or WhatsApp message · English, हिंदी, मराठी</p>
        </div>
      </header>

      <section className="card p-5">
        <label htmlFor="msg" className="mb-2 block font-semibold">Paste the message you received</label>
        <textarea id="msg" className="field min-h-[130px] text-[16px]" value={text} onChange={(e) => setText(e.target.value)} maxLength={3000}
          placeholder="Dear customer, your account will be blocked today…" />
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLES.map((s) => <button key={s.label} className="chip" onClick={() => setText(s.text)}>{s.label}</button>)}
        </div>
        <button className="btn-primary mt-4 w-full text-[17px]" disabled={busy || text.trim().length < 3} onClick={check}>
          {busy ? "Checking…" : "Check message"}
        </button>
        {error && <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>{error}</p>}
      </section>

      {verdict && L && (
        <section className="mt-5 overflow-hidden rounded-2xl" style={{ border: `2px solid ${L.bg}` }}>
          <div className="flex items-center gap-4 p-5" style={{ background: L.bg, color: L.fg }}>
            <div className="text-5xl font-extrabold leading-none">{Math.round(verdict.risk)}%</div>
            <div>
              <div className="text-xl font-bold">{L.title}</div>
              <div className="text-sm opacity-95">{verdict.category ? `${verdict.category} · ` : ""}{L.sub}</div>
            </div>
          </div>
          <div className="p-5" style={{ background: "var(--surface)" }}>
            {verdict.signals.length > 0 ? (
              <>
                <h2 className="mb-2 font-semibold">Why Kavach thinks so</h2>
                <ul className="space-y-2">
                  {verdict.signals.map((s) => (
                    <li key={s.id} className="flex gap-3 rounded-xl p-3" style={{ background: L.soft }}>
                      <span aria-hidden className="mt-0.5 font-bold" style={{ color: L.bg }}>!</span>
                      <div>
                        <div className="font-medium">{s.label}</div>
                        {s.evidence && <div className="text-sm" style={{ color: "var(--muted)" }}>Found: “{s.evidence}”</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p style={{ color: "var(--muted)" }}>No warning signs found in the text.</p>
            )}
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              AI model: {verdict.model_probability}% · warning signs: {verdict.signal_score}% · {verdict.ms} ms. Kavach can be wrong: when in doubt, contact the company through its official app.
            </p>
          </div>
        </section>
      )}

      {verdict && (
        <section className="card mt-5 p-5">
          <label className="flex items-center gap-3 font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={lost} onChange={(e) => setLost(e.target.checked)} />
            I already lost money or shared an OTP / installed an app
          </label>
          {lost && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <textarea className="field sm:col-span-2" rows={3} value={story} onChange={(e) => setStory(e.target.value)} placeholder="What happened? e.g. I clicked the link, entered my card details and got an OTP…" />
              <input className="field" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="Amount lost (₹)" aria-label="Amount lost" />
              <input className="field" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ""))} placeholder="How many hours ago?" aria-label="Hours ago" />
              <select className="field" value={paidVia} onChange={(e) => setPaidVia(e.target.value)} aria-label="Paid via">
                <option value="upi">UPI</option><option value="card">Debit / credit card</option><option value="netbanking">Net banking</option><option value="wallet">Wallet</option><option value="other">Other</option>
              </select>
              <input className="field" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Your bank (e.g. SBI)" aria-label="Bank" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={otp} onChange={(e) => setOtp(e.target.checked)} /> I shared an OTP, PIN or password</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={app} onChange={(e) => setApp(e.target.checked)} /> I installed an app they asked for</label>
            </div>
          )}
          <button className="btn-primary mt-4" onClick={recover} disabled={recBusy}>{recBusy ? "Preparing your plan…" : lost ? "Get my recovery plan" : "What should I do?"}</button>

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
              {recovery.narrative && (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
                  <div className="mb-2 flex items-center justify-between"><span className="font-semibold">Incident description for cybercrime.gov.in</span>
                    <button className="btn-ghost text-sm" onClick={() => navigator.clipboard.writeText(recovery.narrative!.incident)}>Copy</button></div>
                  <p className="whitespace-pre-wrap text-sm">{recovery.narrative.incident}</p>
                  {recovery.narrative.missing.length > 0 && <p className="mt-2 text-xs" style={{ color: "var(--amber)" }}>Add before filing: {recovery.narrative.missing.join(", ")}</p>}
                </div>
              )}
              {recovery.letter && (
                <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
                  <div className="mb-2 flex items-center justify-between"><span className="font-semibold">Letter to your bank</span>
                    <button className="btn-ghost text-sm" onClick={() => navigator.clipboard.writeText(recovery.letter!)}>Copy</button></div>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{recovery.letter}</pre>
                </div>
              )}
              {recovery.note && <p className="text-sm" style={{ color: "var(--amber)" }}>{recovery.note}</p>}
            </div>
          )}
        </section>
      )}

      <section className="card mt-5 p-5">
        <h2 className="font-semibold">Got a suspicious call? Check the voice</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>Upload a WAV call recording. VaaniShield, my AI voice-clone detector, checks whether the voice is real or synthetic.</p>
        <input type="file" accept="audio/wav,.wav" className="mt-3 text-sm" onChange={(e) => e.target.files?.[0] && checkVoice(e.target.files[0])} />
        {voiceBusy && <p className="mt-2 text-sm">Analysing voice… (may take a minute to wake up)</p>}
        {voice && <p className="mt-2 font-medium">{voice.risk < 0 ? voice.label : `${voice.label} · clone risk ${Math.round(voice.risk)}%`}</p>}
      </section>

      <footer className="mt-8 text-center text-xs" style={{ color: "var(--muted)" }}>
        Report fraud: call 1930 · cybercrime.gov.in · Built by Shravan Kasar. Kavach gives guidance, not legal or financial advice.
      </footer>
    </main>
  );
}
