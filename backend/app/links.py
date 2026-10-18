"""Deep link check: where a link really goes, how old its domain is, and whether it is on a public phishing list.

Free, key-less sources only: OpenPhish community feed (phishing), URLhaus (malware links), RDAP (domain
registration date). Every network step has a short timeout; if a source is down the check says "unknown"
instead of guessing. The server never renders or runs the page, it only reads redirect headers.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

from .signals import OFFICIAL, SHORTENERS, URL_RE, Signal

UA = "Mozilla/5.0 (Linux; Android 14) KavachLinkCheck/1.0 (+scam checker; reads redirect headers only)"
FEEDS = {
    "openphish": "https://openphish.com/feed.txt",
    "urlhaus": "https://urlhaus.abuse.ch/downloads/text_online/",
}
# free hosting platforms: one bad page there does not make the whole site bad, so only exact URLs count
PLATFORMS = ("github.com", "githubusercontent.com", "google.com", "googleusercontent.com", "web.app", "firebaseapp.com",
             "pages.dev", "workers.dev", "vercel.app", "netlify.app", "blogspot.com", "wixsite.com", "weebly.com",
             "000webhostapp.com", "glitch.me", "onrender.com", "herokuapp.com", "dropbox.com", "1drv.ms", "sharepoint.com",
             "forms.gle", "t.me", "wa.me", "linktr.ee", "bit.ly", "tinyurl.com")
SECOND_LEVEL = {"co", "org", "net", "gov", "ac", "edu", "gen", "firm", "ind", "nic", "res", "com", "bank"}
TRUSTED = {d for ds in OFFICIAL.values() for d in ds} | {"google.com", "youtube.com", "whatsapp.com", "npci.org.in", "rbi.org.in",
                                                        "cybercrime.gov.in", "sancharsaathi.gov.in", "gov.in", "nic.in"}

_lists: dict[str, set[str]] = {"urls": set(), "hosts": set()}
_lists_at = 0.0
_lock = threading.Lock()


def _open(req: urllib.request.Request, timeout: float):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    return urllib.request.build_opener(NoRedirect).open(req, timeout=timeout)


def _norm(url: str) -> str:
    return url.strip().rstrip("/").lower()


def _refresh_lists() -> None:
    global _lists_at
    urls, hosts = set(), set()
    for name, feed in FEEDS.items():
        try:
            body = urllib.request.urlopen(urllib.request.Request(feed, headers={"User-Agent": UA}), timeout=20).read().decode("utf-8", "ignore")
        except Exception:
            continue
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            urls.add(_norm(line))
            host = (urlparse(line).hostname or "").lower()
            # phishing pages usually sit on a throwaway domain; malware feeds are mostly raw IPs and platforms
            if name == "openphish" and host and not host.endswith(PLATFORMS):
                hosts.add(host)
    if urls:
        with _lock:
            _lists["urls"], _lists["hosts"] = urls, hosts
            _lists_at = time.time()


def warm_lists() -> None:
    """Loads the phishing lists in the background and refreshes them every 3 hours."""
    def loop():
        while True:
            _refresh_lists()
            time.sleep(3 * 3600)

    threading.Thread(target=loop, daemon=True).start()


def lists_info() -> dict:
    return {"urls": len(_lists["urls"]), "hosts": len(_lists["hosts"]), "updated": int(_lists_at) or None}


def registrable(host: str) -> str:
    parts = host.lower().strip(".").split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in SECOND_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _public_host(host: str) -> bool:
    """Refuses to touch private or local addresses (the checker must not be usable to probe internal networks)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def expand(url: str, hops: int = 5, timeout: float = 4.0) -> dict:
    """Follows redirects by reading Location headers only. Returns the chain and the final URL."""
    chain = [url]
    current = url
    for _ in range(hops):
        p = urlparse(current)
        if p.scheme not in ("http", "https") or not p.hostname:
            break
        if not _public_host(p.hostname):
            return {"chain": chain, "final": current, "error": "unresolvable or private address"}
        nxt = None
        attempts = [("HEAD", 0), ("GET", 0), ("GET", 1)]  # one retry: shorteners sometimes reset a connection
        i = 0
        while i < len(attempts):
            method, retry = attempts[i]
            i += 1
            try:
                with _open(urllib.request.Request(current, method=method, headers={"User-Agent": UA}), timeout):
                    break
            except urllib.error.HTTPError as e:
                if 300 <= e.code < 400 and e.headers.get("Location"):
                    nxt = urljoin(current, e.headers["Location"])
                    break
                if method == "HEAD" and e.code in (403, 405, 501):
                    continue
                break
            except Exception as e:  # timeout, TLS failure, connection refused
                if i < len(attempts):
                    time.sleep(0.3)
                    continue
                return {"chain": chain, "final": current, "error": type(e).__name__}
        if not nxt or nxt in chain:
            break
        chain.append(nxt)
        current = nxt
    return {"chain": chain, "final": current, "error": None}


def domain_age_days(host: str, timeout: float = 4.0) -> int | None:
    """Days since the domain was registered, from RDAP. None when the registry doesn't say."""
    try:
        req = urllib.request.Request(f"https://rdap.org/domain/{registrable(host)}", headers={"User-Agent": UA, "Accept": "application/rdap+json"})
        data = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except Exception:
        return None
    for ev in data.get("events", []):
        if ev.get("eventAction") == "registration" and ev.get("eventDate"):
            try:
                born = datetime.fromisoformat(ev["eventDate"].replace("Z", "+00:00"))
                return max(0, (datetime.now(timezone.utc) - born).days)
            except ValueError:
                return None
    return None


def listed(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    with _lock:
        return _norm(url) in _lists["urls"] or host in _lists["hosts"]


def check_link(raw: str) -> dict:
    url = raw if re.match(r"https?://", raw, re.I) else "http://" + raw
    exp = expand(url)
    final = exp["final"]
    hosts = [(urlparse(u).hostname or "").lower() for u in exp["chain"]]
    final_host = hosts[-1]
    trusted = any(final_host == d or final_host.endswith("." + d) for d in TRUSTED)
    age = None if trusted else domain_age_days(final_host)
    on_list = any(listed(u) for u in exp["chain"])
    return {
        "input": raw,
        "final_url": final,
        "chain": exp["chain"],
        "redirected": len(exp["chain"]) > 1,
        "shortener": hosts[0] in SHORTENERS,
        "final_domain": registrable(final_host) if final_host else None,
        "domain_age_days": age,
        "phishing_listed": on_list,
        "official": trusted,
        "error": exp["error"],
        "lists_loaded": bool(_lists["urls"]),
    }


def link_signals(results: list[dict]) -> list[Signal]:
    out: list[Signal] = []
    for r in results:
        if r["phishing_listed"]:
            out.append(Signal("phishing_listed", "This link is on a public list of known phishing or malware websites", 0.95, r["final_domain"] or r["input"]))
        age = r["domain_age_days"]
        if age is not None and age < 90 and not r["official"]:
            out.append(Signal("new_domain", f"The website was registered only {age} days ago; real banks and companies use old, established websites", 0.7 if age < 30 else 0.5, r["final_domain"]))
        if r["redirected"] and r["final_domain"] and r["final_domain"] != registrable((urlparse(r["chain"][0]).hostname or "")):
            out.append(Signal("hidden_redirect", f"The link secretly forwards you to a different website: {r['final_domain']}", 0.35, r["final_domain"]))
    return out


def check_text_links(text: str, budget: float = 6.0) -> list[dict]:
    raws = []
    for m in URL_RE.finditer(text):
        raw = m.group(0).rstrip(".,;:!?)\"'")
        if raw not in raws:
            raws.append(raw)
    raws = raws[:3]
    if not raws:
        return []
    pool = ThreadPoolExecutor(max_workers=len(raws))
    futures = [pool.submit(check_link, r) for r in raws]
    pool.shutdown(wait=False)  # a slow site must not hold up the verdict past the budget
    out = []
    deadline = time.time() + budget
    for f in futures:
        try:
            out.append(f.result(timeout=max(0.1, deadline - time.time())))
        except Exception:
            pass
    return out
