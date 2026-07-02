"""Web search — free, keyless, via DuckDuckGo (ddgs). Caution tier (network egress).

Results are returned as DATA for the model to summarize. They are never treated as
instructions (the untrusted-content firewall principle).
"""

from ..kernel import Tier, tool


@tool("web.search", Tier.SAFE, "Search the web (DuckDuckGo)", network=True,
      summarize=lambda a: f"Search the web: {a.get('query', '')[:60]}")
def search(query="", max_results=6):
    if not (query or "").strip():
        return {"ok": False, "error": "Empty query."}
    try:
        from ddgs import DDGS
        with DDGS() as d:
            raw = list(d.text(query, max_results=int(max_results)))
        results = [{
            "title": r.get("title", ""),
            "url": r.get("href") or r.get("url") or "",
            "snippet": r.get("body") or r.get("snippet") or "",
        } for r in raw]
        return {"ok": True, "query": query, "results": results}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "query": query}


@tool("web.fetch", Tier.SAFE, "Open a web page and read its text", network=True,
      summarize=lambda a: f"Read page: {a.get('url', '')[:60]}")
def fetch(url="", max_chars=7000):
    if not (url or "").strip():
        return {"ok": False, "error": "No URL."}
    import re
    import httpx
    try:
        r = httpx.get(url, timeout=25, follow_redirects=True,
                      headers={"User-Agent": "Mozilla/5.0 (Veyra)"})
        html = r.text
        html = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", html, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return {"ok": True, "url": url, "text": text[:int(max_chars)]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
