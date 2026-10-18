// QR check, fully on the phone: decode the QR in a photo/screenshot and explain what scanning it would do.

export type QrResult =
  | { kind: "none" }
  | { kind: "upi"; raw: string; pa: string; pn: string | null; am: string | null; tn: string | null; personalVpa: boolean; nameLooksBusiness: boolean; suspicious: boolean }
  | { kind: "link"; raw: string }
  | { kind: "text"; raw: string };

async function toImageData(file: Blob, maxSide = 1600): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function decodeQr(file: Blob): Promise<string | null> {
  const jsQR = (await import("jsqr")).default;
  // a QR inside a big screenshot can be small: try the full image, then smaller and larger renderings
  for (const side of [1600, 900, 2400]) {
    const img = await toImageData(file, side);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;
  }
  return null;
}

const BUSINESS = /\b(bank|sbi|hdfc|icici|axis|kotak|pnb|paytm|phonepe|gpay|google|amazon|flipkart|electricity|bijli|msedcl|mahavitaran|post|police|govt|government|income ?tax|customer ?care|support|refund|ltd|limited|pvt)\b/i;

const TRICK = /refund|cashback|prize|reward|receive|lottery|winner|kyc|रिफंड|इनाम|कैशबैक|परतावा|बक्षीस|कॅशबॅक/i;

export function explainQr(raw: string): QrResult {
  const s = raw.trim();
  if (/^upi:\/\//i.test(s)) {
    const q = new URLSearchParams(s.slice(s.indexOf("?") + 1));
    const pa = q.get("pa") ?? "";
    const pn = q.get("pn");
    const personalVpa = /^(\+?91)?[6-9]\d{9}@/.test(pa);
    const nameLooksBusiness = !!pn && BUSINESS.test(pn);
    return {
      kind: "upi",
      raw: s,
      pa,
      pn,
      am: q.get("am"),
      tn: q.get("tn"),
      personalVpa,
      nameLooksBusiness,
      // a payment QR is normal at a shop; it is a trick when it promises money back or hides behind a brand name
      suspicious: (personalVpa && nameLooksBusiness) || TRICK.test(`${pn ?? ""} ${q.get("tn") ?? ""}`),
    };
  }
  if (/^(https?:\/\/|www\.)/i.test(s)) return { kind: "link", raw: s };
  return { kind: "text", raw: s };
}
