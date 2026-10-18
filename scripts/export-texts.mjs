// Copies the app's Hindi/Marathi wording into the backend so the Telegram bot says exactly what the app says.
// Run after editing web/src/lib/i18n.ts:  node scripts/export-texts.mjs
import { writeFileSync } from "node:fs";
const m = await import("../web/src/lib/i18n.ts");
const keys = ["canBeWrong", "noSigns", "why", "found", "footer"];
const ui = Object.fromEntries(Object.entries(m.UI).map(([lang, d]) => [lang, Object.fromEntries(keys.map((k) => [k, d[k]]))]));
const out = { level: m.LEVEL_TEXT, signal: m.SIGNAL_TEXT, category: m.CATEGORY_TEXT, ui };
writeFileSync(new URL("../backend/app/texts.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("wrote backend/app/texts.json");
