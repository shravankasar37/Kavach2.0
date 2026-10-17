// LLM access for the agents, routed across free providers with automatic failover.
// Each call walks ROUTES in order (default: Groq models, then Gemini models); a route that is rate limited (429)
// or overloaded (5xx) gets one short retry, then the next route answers. JSON output is validated with zod and
// re-asked once on a mismatch. Usage reports which provider and model answered, for the trace.
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";

type Provider = "groq" | "gemini";
type Route = { provider: Provider; model: string };

function buildRoutes(): Route[] {
  const groq: Route[] = process.env.GROQ_API_KEY
    ? [...new Set([process.env.GROQ_MODEL, "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"].filter(Boolean) as string[])].map((model) => ({ provider: "groq" as const, model }))
    : [];
  const gemini: Route[] = process.env.GEMINI_API_KEY
    ? [...new Set([process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"].filter(Boolean) as string[])].map((model) => ({ provider: "gemini" as const, model }))
    : [];
  const order = (process.env.LLM_ORDER ?? "groq,gemini").split(",").map((s) => s.trim());
  return order.flatMap((p) => (p === "groq" ? groq : p === "gemini" ? gemini : []));
}
const ROUTES = buildRoutes();

export type Usage = { agent: string; model: string; ms: number; inputTokens: number; outputTokens: number };
type CallOpts = { agent: string; system: string; prompt: string; temperature?: number; onUsage?: (u: Usage) => void };
type Reply = { text: string; inputTokens: number; outputTokens: number };

/** An HTTP failure from any provider, so failover logic does not depend on one SDK's error class. */
export class LlmError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
  }
}

/** Groq says "Please try again in 17.69s" (or a Retry-After header) when a per-minute budget is spent. */
function retryAfter(res: Response, body: string): number | undefined {
  const h = Number(res.headers.get("retry-after"));
  if (h > 0) return h * 1000;
  const m = /try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/.exec(body);
  return m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 : undefined;
}
const statusOf = (e: unknown) => (e instanceof LlmError ? e.status : e instanceof ApiError ? e.status : 0);
const transient = (e: unknown) => statusOf(e) === 429 || statusOf(e) >= 500;
/** Every route is out of quota or overloaded. */
export const isQuotaError = (e: unknown) => transient(e);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Groq (OpenAI-compatible chat completions) ----------
async function groqCall(model: string, opts: CallOpts, jsonSchema?: unknown): Promise<Reply> {
  const system = jsonSchema
    ? `${opts.system}\n\nReply with a single JSON object that conforms to this JSON Schema, and nothing else:\n${JSON.stringify(jsonSchema)}`
    : opts.system;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: opts.prompt },
      ],
      ...(jsonSchema ? { response_format: { type: "json_object" } } : {}),
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "medium" } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // In JSON mode Groq rejects a malformed sample with a 400 ("Failed to validate/generate JSON"). That is a bad
    // draw, not a bad request: report it as retryable so the router samples again or fails over.
    const badSample = res.status === 400 && /json_validate_failed|Failed to (?:validate|generate) JSON/i.test(body);
    throw new LlmError(`groq ${model} ${res.status}: ${body.slice(0, 300)}`, badSample ? 502 : res.status, retryAfter(res, body));
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  return { text: j.choices?.[0]?.message?.content ?? "", inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
}

// ---------- Gemini ----------
let gemini: GoogleGenAI | null = null;
async function geminiCall(model: string, opts: CallOpts, jsonSchema?: unknown): Promise<Reply> {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await gemini.models.generateContent({
    model,
    contents: opts.prompt,
    config: {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? 0.2,
      ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
    },
  });
  return { text: res.text ?? "", inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 };
}

// ---------- routing ----------
async function call(opts: CallOpts, jsonSchema?: unknown): Promise<string> {
  if (!ROUTES.length) throw new Error("No LLM provider configured: set GROQ_API_KEY and/or GEMINI_API_KEY (see .env.example)");
  const t0 = Date.now();
  let last: unknown;
  // Free tiers meter tokens per minute: when every route is spent, wait for the soonest reset and go round
  // again (at most 4 rounds, never waiting more than 30 s at a time), instead of failing the user.
  for (let round = 0; round < 4; round++) {
    let soonest = Infinity;
    for (const route of ROUTES) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = route.provider === "groq" ? await groqCall(route.model, opts, jsonSchema) : await geminiCall(route.model, opts, jsonSchema);
          if (!r.text) throw new LlmError(`${opts.agent}: empty response from ${route.provider}/${route.model}`, 502);
          opts.onUsage?.({ agent: opts.agent, model: `${route.provider}/${route.model}`, ms: Date.now() - t0, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
          return r.text;
        } catch (e) {
          if (!transient(e)) throw e;
          last = e;
          if (e instanceof LlmError && e.retryAfterMs) soonest = Math.min(soonest, e.retryAfterMs);
          // a 429 means this route's budget is spent for now: try the next route rather than wait
          if (attempt === 0 && statusOf(e) !== 429) await sleep(1_500);
          else break;
        }
      }
    }
    // no route said when it resets (for example a daily quota): waiting would not help
    if (!Number.isFinite(soonest) || soonest > 30_000) break;
    await sleep(soonest + 500);
  }
  throw last;
}

/** Strips a ```json fence some models add despite JSON mode. */
const unfence = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** Calls the model with a JSON schema derived from `schema`; validates the result, re-asking once on a mismatch. */
export async function generateJson<T>(schema: z.ZodType<T>, opts: CallOpts): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await call({ ...opts, prompt }, jsonSchema);
    let parsed: unknown;
    try {
      parsed = JSON.parse(unfence(raw));
    } catch {
      parsed = undefined;
    }
    const r = schema.safeParse(parsed);
    if (r.success) return r.data;
    prompt = `${opts.prompt}\n\nYour previous reply did not match the required JSON schema (${r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}). Reply again with valid JSON only.`;
  }
  throw new Error(`${opts.agent}: model output did not match the schema twice`);
}

export const generateText = (opts: CallOpts) => call(opts);

export const configuredRoutes = () => ROUTES.map((r) => `${r.provider}/${r.model}`);
