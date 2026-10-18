// Recovery agent: deterministic plan + bank letter from code, and an incident description for the
// cybercrime.gov.in form drafted by the model from the user's own facts only.
import { z } from "zod";
import { generateJson, isQuotaError } from "@/lib/llm";
import { bankLetter, recoveryPlan, type Facts } from "@/lib/recovery";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  message: z.string().max(3000).default(""),
  story: z.string().max(3000).default(""),
  category: z.string().nullable().optional(),
  lang: z.enum(["en", "hi", "mr"]).default("en"),
  facts: z.object({
    lostMoney: z.boolean(),
    amount: z.number().nullable().optional(),
    hoursAgo: z.number().nullable().optional(),
    paidVia: z.enum(["upi", "card", "netbanking", "wallet", "other"]).nullable().optional(),
    sharedOtpOrPin: z.boolean().optional(),
    installedApp: z.boolean().optional(),
    bank: z.string().max(80).nullable().optional(),
  }),
});

const Narrative = z.object({
  incident: z.string().describe("first-person incident description for the cybercrime.gov.in form, 120-220 words, English"),
  missing: z.array(z.string()).max(6).describe("details the user should add, e.g. transaction ID, time, sender number"),
});
const FactCheck = z.object({ issues: z.array(z.string()).describe("statements in the draft not supported by the given facts; empty if none") });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { message, story, category, facts, lang } = parsed.data;
  const f = facts as Facts;
  const steps = recoveryPlan(f, lang);
  const letter = f.lostMoney ? bankLetter(f) : null;

  let narrative: z.infer<typeof Narrative> | null = null;
  let note: string | undefined;
  if (f.lostMoney) {
    const given = `Scam message received:\n"""${message}"""\n\nScam type (from Kavach): ${category ?? "unknown"}\n\nWhat the user says happened:\n"""${story}"""\n\nFacts: ${JSON.stringify(f)} (amount is the TOTAL lost; hoursAgo is how long ago it happened)`;
    const system =
      "You help an Indian cyber-fraud victim write the incident description for the National Cyber Crime Reporting Portal. Write in the first person, plain formal English, in time order: how the scammer contacted them, what was claimed, what the victim did, what was lost. Use ONLY the facts given. Write [placeholder] for anything not given (dates, times, sender number, transaction IDs, per-transaction amounts). Do not add details, durations ('within minutes'), negatives ('I have not received...') or conclusions the user did not state. No legal advice.";
    try {
      narrative = await generateJson(Narrative, { agent: "recovery.narrative", system, prompt: given, temperature: 0.2 });
      // fact-faithfulness check (as in NyayaSathi): one rewrite if the draft says more than the user did
      const check = await generateJson(FactCheck, {
        agent: "recovery.factcheck",
        system:
          "Compare the DRAFT with the GIVEN facts. List every statement in the draft that asserts something not in the given facts (an amount split, a time, an action, a negative statement, an outcome). [Bracketed placeholders] are fine and are never issues.",
        prompt: `GIVEN\n${given}\n\nDRAFT\n${narrative.incident}`,
        temperature: 0,
      });
      if (check.issues.length) {
        narrative = await generateJson(Narrative, {
          agent: "recovery.narrative",
          system,
          prompt: `${given}\n\nYour previous draft added facts the user never gave. Remove them or turn them into [placeholders]:\n${check.issues.map((i) => `- ${i}`).join("\n")}`,
          temperature: 0.1,
        });
      }
    } catch (e) {
      note = isQuotaError(e) ? "The free AI quota is used up right now; use the steps and bank letter, and describe the incident in your own words." : "Couldn't draft the description just now.";
    }
  }
  return Response.json({ steps, letter, narrative, note });
}
