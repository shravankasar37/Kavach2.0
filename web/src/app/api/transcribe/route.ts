// Call Guard speech-to-text: Whisper large-v3 on Groq's free tier (handles Hindi, Marathi and English).
// The recording is sent to Groq for transcription only and is not stored by Kavach.
const MAX_BYTES = 10 * 1024 * 1024;
const recent = new Map<string, number[]>();

function rateOk(ip: string, limit = 60, perMs = 3600_000) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < perMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  recent.set(ip, hits);
  return true;
}

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return Response.json({ error: "Transcription is not configured on this server." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!rateOk(ip)) return Response.json({ error: "Too many recordings; please try again later." }, { status: 429 });

  const form = await req.formData();
  const file = form.get("file");
  const lang = String(form.get("lang") ?? "");
  if (!file || typeof file === "string") return Response.json({ error: "No recording received." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Recording is too long; send up to about 10 minutes." }, { status: 413 });

  const out = new FormData();
  out.append("file", file, file.name || "call.webm");
  out.append("model", "whisper-large-v3");
  out.append("response_format", "verbose_json");
  out.append("temperature", "0");
  // pinning Hindi/Marathi keeps the output in Devanagari; for English let Whisper detect (calls are often Hinglish)
  if (lang === "hi" || lang === "mr") out.append("language", lang);

  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: out });
  if (!r.ok) {
    const status = r.status === 429 ? 429 : 502;
    return Response.json({ error: status === 429 ? "Transcription is busy; please try again in a minute." : "Couldn't transcribe the recording." }, { status });
  }
  const j = (await r.json()) as { text?: string; language?: string; duration?: number };
  return Response.json({ text: (j.text ?? "").trim(), language: j.language ?? null, duration: j.duration ?? null });
}
