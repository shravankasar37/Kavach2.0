// Fallback for "Share to Kavach" when the service worker is not active yet: shared text travels in the URL hash
// (never sent to a server log), images need the service worker and are skipped here.
export async function POST(req: Request) {
  const form = await req.formData();
  const text = [form.get("title"), form.get("text"), form.get("url")].filter((v): v is string => typeof v === "string" && !!v).join("\n").trim();
  return new Response(null, { status: 303, headers: { Location: `/?shared=1#text=${encodeURIComponent(text.slice(0, 3000))}` } });
}
