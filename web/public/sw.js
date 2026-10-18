// Kavach service worker: receives "Share to Kavach" from other apps (Web Share Target, POST /share), keeps the
// shared text / screenshot in the Cache API and opens the app, which picks it up. Nothing leaves the phone here.
const SHARE_CACHE = "kavach-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n").trim();
        const cache = await caches.open(SHARE_CACHE);
        await cache.put("/shared/text", new Response(text));
        const image = form.get("image");
        if (image && typeof image !== "string") await cache.put("/shared/image", new Response(image, { headers: { "Content-Type": image.type } }));
        else await cache.delete("/shared/image");
        return Response.redirect("/?shared=1", 303);
      })(),
    );
  }
});
