"use client";

// Call Guard: listens to a call on speaker (or takes a recording / WhatsApp voice note), writes down what the
// caller says, checks it for scam scripts such as "digital arrest", and checks whether the voice is AI-made.
// Android does not let apps record the call line itself, so the phone's microphone hears the speaker instead.
import { useEffect, useRef, useState } from "react";
import { categoryText, LEVEL_TEXT, signalText, type Lang } from "@/lib/i18n";
import { splitWav16k, toWav16k } from "@/lib/wav";

const VAANI_HEALTH = "https://vaanishield-api.onrender.com/health";
const VOICE_THRESHOLD = 36; // VaaniShield's calibrated decision threshold (risk score 0-100)
const SEGMENT_MS = 15_000;

type Sig = { id: string; label: string };
type Verdict = { risk: number; level: "high" | "medium" | "low"; category: string | null; signals: Sig[] };
type T = (k: string) => string;

export default function CallGuard({ api, lang, L }: { api: string; lang: Lang; L: T }) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [voice, setVoice] = useState<number | null | "na">(null);
  const [error, setError] = useState("");
  const live = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const text = useRef("");
  const voiceDone = useRef(false);
  const alerted = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // every new recording gets a run id; results that arrive for an older run are dropped
  const run = useRef(0);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // the voice-clone service sleeps on its free tier: start waking it as soon as the user reaches for Call Guard
  const wakeVoice = () => fetch(`${VAANI_HEALTH}`, { mode: "no-cors" }).catch(() => {});

  async function checkVoice(audio: Blob, id: number) {
    voiceDone.current = true;
    let score: number | "na" = "na";
    try {
      const fd = new FormData();
      fd.append("file", await toWav16k(audio, 8), "call.wav");
      const r = await fetch("/api/voice", { method: "POST", body: fd });
      if (r.ok) score = (await r.json()).risk_score;
    } catch {}
    if (id === run.current) setVoice(score);
  }

  async function analyse(full: string, id: number) {
    const r = await fetch(`${api}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: full.slice(-3000) }) });
    if (!r.ok || id !== run.current) return;
    const v: Verdict = await r.json();
    if (id !== run.current) return;
    setVerdict(v);
    if (v.level === "high" && !alerted.current) {
      alerted.current = true;
      navigator.vibrate?.([500, 200, 500, 200, 500]);
    }
  }

  async function handleAudio(audio: Blob, id: number) {
    if (audio.size < 2000 || id !== run.current) return;
    if (!voiceDone.current) checkVoice(audio, id);
    const fd = new FormData();
    const ext = audio instanceof File && audio.name.includes(".") ? audio.name.split(".").pop()
      : audio.type.includes("wav") ? "wav" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
    fd.append("file", audio, `call.${ext}`);
    fd.append("lang", lang);
    const r = await fetch("/api/transcribe", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (id !== run.current) return;
    if (!r.ok) return setError(j.error || L("transcribeFail"));
    if (!j.text) return;
    text.current = `${text.current} ${j.text}`.trim();
    setTranscript(text.current);
    if (text.current.length >= 3) await analyse(text.current, id);
  }

  function reset() {
    run.current += 1;
    text.current = "";
    voiceDone.current = false;
    alerted.current = false;
    setTranscript("");
    setVerdict(null);
    setVoice(null);
    setError("");
  }

  function recordSegment() {
    if (!live.current || !stream.current) return;
    const id = run.current;
    // each segment is a complete file, so it can be transcribed on its own while the next one records
    const rec = new MediaRecorder(stream.current);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType });
      queue.current = queue.current.then(() => handleAudio(blob, id)).catch(() => {});
      recordSegment();
    };
    recorder.current = rec;
    rec.start();
    setTimeout(() => rec.state === "recording" && rec.stop(), SEGMENT_MS);
  }

  async function start() {
    reset();
    wakeVoice();
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError(L("callMicBlocked"));
    }
    live.current = true;
    setListening(true);
    recordSegment();
  }

  function stop() {
    live.current = false;
    setListening(false);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function upload(file: File) {
    reset();
    wakeVoice();
    const id = run.current;
    setBusy(true);
    try {
      let pieces: Blob[] = [file];
      try {
        pieces = await splitWav16k(file);
      } catch {
        // a format this browser can't decode (e.g. .amr): send it whole and let Whisper read it
      }
      for (const piece of pieces) await handleAudio(piece, id);
    } finally {
      if (id === run.current) setBusy(false);
    }
  }

  const LV = verdict ? LEVEL_TEXT[lang][verdict.level] : null;
  const color = verdict ? { high: "var(--red)", medium: "var(--amber)", low: "var(--green)" }[verdict.level] : "";

  return (
    <section className="card mt-5 p-5" onPointerEnter={wakeVoice} onFocus={wakeVoice}>
      <h2 className="font-semibold">{L("callTitle")}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{L("callBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {listening
          ? <button className="btn-primary" style={{ background: "var(--red)" }} onClick={stop}>■ {L("callStop")}</button>
          : <button className="btn-primary" onClick={start} disabled={busy}>🎙 {L("callStart")}</button>}
        <label className="btn-ghost cursor-pointer text-sm">
          ⬆ {L("callUpload")}
          <input type="file" accept="audio/*,.opus,.ogg,.m4a,.amr,.wav,.mp3" className="hidden" disabled={listening}
            onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </div>
      {listening && <p className="mt-2 text-sm font-medium" style={{ color: "var(--blue)" }}>● {L("callListening")}</p>}
      {busy && <p className="mt-2 text-sm">{L("checking")}</p>}
      {error && <p className="mt-2 text-sm" style={{ color: "var(--red)" }}>{error}</p>}

      {verdict && LV && (
        <div className="mt-4 overflow-hidden rounded-xl" style={{ border: `2px solid ${color}` }} aria-live="assertive">
          <div className="p-3" style={{ background: color, color: "#fff" }}>
            <div className="text-lg font-bold">{verdict.level === "high" ? L("callAlert") : LV.title}</div>
            <div className="text-sm opacity-95">{verdict.category ? `${categoryText(lang, verdict.category)} · ` : ""}{LV.sub}</div>
          </div>
          {verdict.signals.length > 0 && (
            <ul className="space-y-1 p-3 text-sm" style={{ background: "var(--surface)" }}>
              {verdict.signals.slice(0, 5).map((s) => <li key={s.id}>! {signalText(lang, s.id, s.label)}</li>)}
            </ul>
          )}
        </div>
      )}
      {voice !== null && (
        <p className="mt-2 text-sm font-medium" style={{ color: voice === "na" ? "var(--muted)" : voice >= VOICE_THRESHOLD ? "var(--red)" : "var(--green)" }}>
          {voice === "na" ? L("voiceUnknown") : voice >= VOICE_THRESHOLD ? `⚠ ${L("voiceAi")} (${Math.round(voice)}%)` : `✓ ${L("voiceReal")}`}
        </p>
      )}
      {typeof voice === "number" && voice >= VOICE_THRESHOLD && <p className="mt-1 text-sm" style={{ color: "var(--red)" }}>{L("voiceAiAdvice")}</p>}
      {transcript && (
        <details className="mt-3 text-sm" open={!verdict}>
          <summary className="cursor-pointer font-medium">{L("callTranscript")}</summary>
          <p className="mt-1 whitespace-pre-wrap" style={{ color: "var(--muted)" }}>{transcript}</p>
        </details>
      )}

      <div className="mt-4 rounded-xl p-4 text-sm" style={{ background: "var(--blue-soft)" }}>
        <div className="mb-1 font-semibold">{L("callRulesTitle")}</div>
        <ol className="list-decimal space-y-1 pl-5">
          {[1, 2, 3, 4, 5].map((i) => <li key={i}>{L(`rule${i}`)}</li>)}
        </ol>
      </div>
    </section>
  );
}
