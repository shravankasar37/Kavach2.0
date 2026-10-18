// Forwards a short 16 kHz WAV clip to VaaniShield (Shravan's voice-clone detector) so the browser never depends on
// VaaniShield's CORS settings. The clip is not stored.
export const maxDuration = 60; // VaaniShield on a free tier can take ~20 s, more if it is waking up

const VAANI = (process.env.VAANISHIELD_API || "https://vaanishield-api.onrender.com").replace(/\/$/, "");

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string" || file.size > 4 * 1024 * 1024) return Response.json({ error: "Send a WAV clip under 4 MB." }, { status: 400 });
  const deadline = Date.now() + 55_000;
  // one retry: the free-tier service returns 502 for a few seconds while it restarts
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = new FormData();
      out.append("file", file, "clip.wav");
      const r = await fetch(`${VAANI}/api/analyze-file`, { method: "POST", body: out, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
      if (r.ok) {
        const j = (await r.json()) as { risk_score: number; label: string };
        return Response.json({ risk_score: j.risk_score, label: j.label });
      }
    } catch {}
    if (deadline - Date.now() < 25_000) break;
    await new Promise((res) => setTimeout(res, 8000));
  }
  return Response.json({ error: "Voice check unavailable" }, { status: 502 });
}
