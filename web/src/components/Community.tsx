"use client";

// Community features: report a scam, look up a number / UPI ID / website, and this week's trending scam types.
import { useEffect, useState } from "react";
import { categoryText, type Lang } from "@/lib/i18n";

export type Known = { kind: "phone" | "upi" | "domain"; value: string; hint: string; reporters: number; flagged: boolean; categories: string[] };
type Lookup = Known & { link?: { final_domain: string | null; domain_age_days: number | null; phishing_listed: boolean; official: boolean; error: string | null } };
type Trending = { days: number; checks: number; categories: { category: string; count: number }[]; domains: { domain: string; reporters: number }[] };
type T = (k: string) => string;

const KIND_KEY = { phone: "phone", upi: "upi", domain: "website" } as const;

function ReportStatus({ k, L }: { k: Pick<Known, "reporters" | "flagged">; L: T }) {
  if (k.flagged) return <span className="font-semibold" style={{ color: "var(--red)" }}>⚠ {L("reportedBy").replace("{n}", String(k.reporters))}</span>;
  if (k.reporters > 0) return <span style={{ color: "var(--amber)" }}>{L("fewReports").replace("{n}", String(k.reporters))}</span>;
  return <span style={{ color: "var(--muted)" }}>{L("noReports")}</span>;
}

export function ReportCard({ api, known, category, text, lang, L }: { api: string; known: Known[]; category: string | null; text: string; lang: Lang; L: T }) {
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(known.map((k) => [k.kind + k.value, true])));
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  if (!known.length) return null;
  async function send() {
    setState("busy");
    try {
      const items = known.filter((k) => picked[k.kind + k.value]).map((k) => ({ kind: k.kind, value: k.value }));
      const r = await fetch(`${api}/api/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, category, text, lang }) });
      setState(r.ok ? "done" : "fail");
    } catch {
      setState("fail");
    }
  }
  return (
    <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
      <h2 className="font-semibold">{L("reportTitle")}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{L("reportBody")}</p>
      <ul className="mt-3 space-y-2">
        {known.map((k) => (
          <li key={k.kind + k.value} className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5" disabled={state === "done"} checked={!!picked[k.kind + k.value]}
              onChange={(e) => setPicked({ ...picked, [k.kind + k.value]: e.target.checked })} aria-label={k.hint} />
            <span className="min-w-0">
              <span className="block break-all font-medium">{L(KIND_KEY[k.kind])}: {k.kind === "domain" ? k.value : k.hint}</span>
              <ReportStatus k={k} L={L} />
            </span>
          </li>
        ))}
      </ul>
      {state === "done" ? <p className="mt-3 text-sm font-medium" style={{ color: "var(--green)" }}>✓ {L("reportDone")}</p> : (
        <button className="btn-primary mt-3" disabled={state === "busy" || !Object.values(picked).some(Boolean)} onClick={send}>{L("reportBtn")}</button>
      )}
      {state === "fail" && <p className="mt-2 text-sm" style={{ color: "var(--red)" }}>{L("reportFail")}</p>}
    </div>
  );
}

function guessKind(v: string): "phone" | "upi" | "domain" | null {
  const s = v.trim();
  if (/^[+\d][\d\s-]{9,15}$/.test(s)) return "phone";
  if (/^[\w.-]{2,64}@[a-z]{2,20}$/i.test(s)) return "upi";
  if (/^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(s)) return "domain";
  return null;
}

export function LookupCard({ api, L }: { api: string; L: T }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Lookup | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    const kind = guessKind(q);
    setRes(null);
    setErr("");
    if (!kind) return setErr(L("invalidId"));
    setBusy(true);
    try {
      const value = kind === "domain" ? q.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] : q.trim();
      const r = await fetch(`${api}/api/lookup?kind=${kind}&value=${encodeURIComponent(value)}`);
      if (r.status === 422) setErr(L("invalidId"));
      else if (!r.ok) setErr(L("unreachable"));
      else setRes(await r.json());
    } catch {
      setErr(L("unreachable"));
    } finally {
      setBusy(false);
    }
  }
  const age = res?.link?.domain_age_days;
  return (
    <section className="card mt-5 p-5">
      <h2 className="font-semibold">{L("lookupTitle")}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{L("lookupBody")}</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input className="field min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("lookupPlaceholder")} aria-label={L("lookupTitle")} />
        <button className="btn-primary" disabled={busy || q.trim().length < 3}>{busy ? "…" : L("lookupBtn")}</button>
      </form>
      {err && <p className="mt-2 text-sm" style={{ color: "var(--red)" }}>{err}</p>}
      {res && (
        <div className="mt-3 space-y-1 rounded-xl border p-3 text-sm" style={{ borderColor: res.flagged ? "var(--red)" : "var(--line)" }}>
          <div className="break-all font-medium">{L(KIND_KEY[res.kind])}: {res.hint}</div>
          <ReportStatus k={res} L={L} />
          {res.link && (
            res.link.official ? <div style={{ color: "var(--green)" }}>✓ {L("official")}</div> : (
              <>
                {res.link.error ? <div style={{ color: "var(--amber)" }}>{L("noSite")}</div>
                  : age == null ? <div style={{ color: "var(--muted)" }}>{L("ageUnknown")}</div>
                  : <div style={{ color: age < 90 ? "var(--red)" : "var(--muted)" }}>{age < 365 ? L("ageDays").replace("{n}", String(age)) : L("ageYears").replace("{n}", String(Math.floor(age / 365)))}</div>}
                {res.link.phishing_listed && <div style={{ color: "var(--red)" }}>⚠ {L("onList")}</div>}
              </>
            )
          )}
        </div>
      )}
    </section>
  );
}

export function TrendingCard({ api, lang, L }: { api: string; lang: Lang; L: T }) {
  const [data, setData] = useState<Trending | null>(null);
  useEffect(() => {
    fetch(`${api}/api/trending`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, [api]);
  // nothing to show until people have used it; never fill this with made-up numbers
  if (!data || !data.categories.length) return null;
  const max = data.categories[0].count;
  return (
    <section className="card mt-5 p-5">
      <h2 className="font-semibold">{L("trendingTitle")}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{L("checksWeek").replace("{n}", String(data.checks))}</p>
      <ul className="mt-3 space-y-2">
        {data.categories.map((c) => (
          <li key={c.category} className="text-sm">
            <div className="flex justify-between gap-2"><span>{categoryText(lang, c.category)}</span><span style={{ color: "var(--muted)" }}>{c.count}</span></div>
            <div className="mt-1 h-2 rounded-full" style={{ background: "var(--blue-soft)" }}>
              <div className="h-2 rounded-full" style={{ width: `${(100 * c.count) / max}%`, background: "var(--blue)" }} />
            </div>
          </li>
        ))}
      </ul>
      {!!data.domains.length && (
        <>
          <h3 className="mt-4 text-sm font-semibold">{L("reportedSites")}</h3>
          <ul className="mt-1 text-sm">{data.domains.map((d) => <li key={d.domain} className="break-all">⚠ {d.domain} · {d.reporters}</li>)}</ul>
        </>
      )}
    </section>
  );
}
