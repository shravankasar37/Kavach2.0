// Pulls candidate scam-message quotes out of news and advisory pages, with their source URL, for manual review.
// Only quoted passages that look like an SMS/WhatsApp message (a link, KYC, OTP, block/disconnect threat, parcel,
// prize, job pay...) are kept. Output: data/real/candidates.jsonl. Nothing is labelled automatically.
import { readFileSync, writeFileSync } from "node:fs";

const urls = readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
const CUES = /(https?:\/\/|bit\.ly|\.in\b|\.com\b|kyc|otp|pan\b|aadhaar|blocked|block(ed)? today|suspend|disconnect|electricity|bijli|parcel|package|customs|address|reward|prize|won|lottery|refund|challan|job|earn|per day|daily|salary|loan|apk|download|click|call|whatsapp|बिजली|कनेक्शन|खाता|ब्लॉक|लिंक|ओटीपी)/i;
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, " ");

const out = [];
for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0" }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) { console.log(`${res.status} ${url}`); continue; }
    const html = await res.text();
    const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    const quotes = new Set();
    for (const m of text.matchAll(/["“”'‘’]([^"“”]{35,420})["“”]/g)) {
      const q = m[1].trim();
      if (CUES.test(q) && !/\b(said|says|told|according to|warned|advised|police|officials?)\b/i.test(q.slice(0, 40))) quotes.add(q);
    }
    for (const q of quotes) out.push({ url, quote: q });
    console.log(`${String(quotes.size).padStart(3)} ${url}`);
  } catch (e) {
    console.log(`ERR ${url} ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }
}
writeFileSync("data/real/candidates.jsonl", out.map((o) => JSON.stringify(o)).join("\n"));
console.log(`\n${out.length} candidate quotes`);
