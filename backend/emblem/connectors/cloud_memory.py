"""Cloud-persistent memory — Emblem remembers facts and context across sessions and
devices, stored in the Emblem Supabase. Keyword + recency recall. The agent loop injects
recalled memory as context so she continues where things left off.
"""

from ..kernel import Tier, tool, vault


def _ci():
    return vault.get_secret("emblem_pg")


@tool("memory.save", Tier.SAFE, "Persist a fact or context to long-term cloud memory", network=True)
def save(content="", kind="fact", tags=None):
    ci = _ci()
    if not ci or not (content or "").strip():
        return {"ok": False, "error": "no content or memory not configured"}
    try:
        import psycopg
        with psycopg.connect(ci, sslmode="require", connect_timeout=20, autocommit=True) as conn:
            conn.execute("insert into public.memory (content, kind, tags) values (%s, %s, %s)",
                         (content.strip(), kind or "fact", tags))
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("memory.recall", Tier.SAFE, "Recall relevant facts/context from long-term cloud memory", network=True)
def recall(query="", limit=8):
    ci = _ci()
    if not ci:
        return {"ok": True, "items": []}
    try:
        import psycopg
        with psycopg.connect(ci, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            terms = [t for t in (query or "").split() if len(t) > 3][:6]
            if terms:
                like = " OR ".join(["content ilike %s"] * len(terms))
                cur.execute(
                    f"select content, kind, created_at from public.memory where {like} "
                    f"order by created_at desc limit %s",
                    tuple(f"%{t}%" for t in terms) + (limit,))
                rows = cur.fetchall()
                if not rows:  # fall back to most recent
                    cur.execute("select content, kind, created_at from public.memory order by created_at desc limit %s", (limit,))
                    rows = cur.fetchall()
            else:
                cur.execute("select content, kind, created_at from public.memory order by created_at desc limit %s", (limit,))
                rows = cur.fetchall()
        return {"ok": True, "items": [{"content": c, "kind": k, "at": t.isoformat()} for c, k, t in rows]}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "items": []}
