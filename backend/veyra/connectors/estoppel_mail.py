"""Estoppel email — Veyra sends and handles mail AS Estoppel.

Uses Estoppel's Resend account + verified domain (estoppel.thequaniac.com).

DB roles used:
  estoppel_pg_ro — read newsletter subscribers + user list (veyra_safe schema)
  estoppel_pg_w  — UPDATE contact_messages for support replies (column-locked)
"""

from ..kernel import Tier, tool, vault

DOMAIN = "estoppel.thequaniac.com"
SENDERS = {
    "hello":      f"Estoppel <hello@{DOMAIN}>",
    "support":    f"Estoppel Support <support@{DOMAIN}>",
    "newsletter": f"Estoppel <newsletter@{DOMAIN}>",
}
SUPPORT_ADDR = f"support@{DOMAIN}"


def _key():
    return vault.get_secret("estoppel_resend_key") or vault.get_secret("resend_key")


def _pg_ro():
    return vault.get_secret("estoppel_pg_ro")


def _pg_w():
    return vault.get_secret("estoppel_pg_w")


def _html(text):
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;'
            f'color:#1a1a1a">{safe.replace(chr(10), "<br>")}</div>')


def _post(endpoint, payload):
    key = _key()
    if not key:
        return {"ok": False, "error": "Estoppel Resend key not set (add estoppel_resend_key in Settings)."}
    try:
        import httpx
        r = httpx.post(f"https://api.resend.com/{endpoint}",
                       headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                       json=payload, timeout=30)
        if r.status_code >= 300:
            return {"ok": False, "error": f"Resend {r.status_code}: {r.text[:200]}"}
        return {"ok": True, "result": r.json()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("estoppel.send_mail", Tier.DANGER,
      "Send an email to anyone from an Estoppel address (hello/support/newsletter)",
      network=True, risk="high",
      summarize=lambda a: f"Estoppel email to {a.get('to', '')}: {str(a.get('subject', ''))[:50]}",
      target=lambda a: a.get("to", ""))
def send_mail(to="", subject="", body="", sender="hello", reply_to=None):
    if not (to or "").strip():
        return {"ok": False, "error": "A recipient is required."}
    frm = SENDERS.get(sender, SENDERS["hello"])
    payload = {"from": frm, "to": [to], "subject": subject or "(no subject)", "html": _html(body)}
    if reply_to:
        payload["reply_to"] = reply_to
    res = _post("emails", payload)
    return {"ok": res["ok"], "to": to, "from": frm, **({} if res["ok"] else {"error": res.get("error")})}


def _newsletter_recipients():
    cs = _pg_ro()
    if not cs:
        return None, "Estoppel DB not connected (estoppel_pg_ro)."
    try:
        import psycopg
        emails = set()
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            # newsletter_subscribers.email is exposed in veyra_safe (needed for send)
            cur.execute("SELECT email FROM veyra_safe.newsletter_subscribers WHERE is_active = true AND email <> ''")
            emails.update(e for (e,) in cur.fetchall() if e)
            try:
                cur.execute("""
                    SELECT u.email FROM veyra_safe.users u
                    LEFT JOIN veyra_safe.profiles p ON p.user_id = u.id
                    WHERE u.is_active = true AND u.email <> ''
                    AND coalesce(p.newsletter_opt_out, false) = false
                """)
                emails.update(e for (e,) in cur.fetchall() if e)
            except Exception:
                pass
        return sorted(emails), None
    except Exception as exc:
        return None, str(exc)


@tool("estoppel.newsletter", Tier.DANGER,
      "Send a newsletter to all Estoppel subscribers and opted-in users",
      network=True, risk="high",
      summarize=lambda a: f"Send Estoppel newsletter: {str(a.get('subject', ''))[:50]}")
def newsletter(subject="", body=""):
    if not (subject or "").strip():
        return {"ok": False, "error": "A subject is required."}
    recipients, err = _newsletter_recipients()
    if err:
        return {"ok": False, "error": err}
    if not recipients:
        return {"ok": False, "error": "No subscribers found."}
    frm = SENDERS["newsletter"]
    html = _html(body)
    sent = 0
    for i in range(0, len(recipients), 100):
        batch = [{"from": frm, "to": [e], "subject": subject, "html": html} for e in recipients[i:i + 100]]
        res = _post("emails/batch", batch)
        if res["ok"]:
            sent += len(batch)
    return {"ok": sent > 0, "sent": sent, "recipients": len(recipients),
            **({} if sent else {"error": "Send failed."})}


@tool("estoppel.support_inbox", Tier.SAFE,
      "Read messages sent to Estoppel support (contact_messages)", network=True)
def support_inbox(status="open", limit=20):
    cs = _pg_ro()
    if not cs:
        return {"ok": False, "error": "Estoppel DB not connected (estoppel_pg_ro)."}
    limit = max(1, min(int(limit or 20), 100))
    try:
        import psycopg
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            if status and status != "all":
                cur.execute("SELECT id, name, email, subject, message, status, created_at "
                            "FROM veyra_safe.contact_messages WHERE status = %s ORDER BY id DESC LIMIT %s",
                            (status, limit))
            else:
                cur.execute("SELECT id, name, email, subject, message, status, created_at "
                            "FROM veyra_safe.contact_messages ORDER BY id DESC LIMIT %s", (limit,))
            cols = [d[0] for d in cur.description]
            rows = [{c: (v.isoformat() if hasattr(v, "isoformat") else v) for c, v in zip(cols, r)}
                    for r in cur.fetchall()]
        return {"ok": True, "count": len(rows), "messages": rows}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("estoppel.support_reply", Tier.DANGER,
      "Reply to an Estoppel support message from support@ and mark it replied",
      network=True, risk="high",
      summarize=lambda a: f"Reply to Estoppel support message #{a.get('id')}")
def support_reply(id=0, body=""):
    cs_ro = _pg_ro()
    cs_w  = _pg_w()
    if not cs_ro or not cs_w:
        return {"ok": False, "error": "Estoppel DB not connected (estoppel_pg_ro / estoppel_pg_w)."}
    try:
        import psycopg
        # Read with ro role (safer — no write perms there)
        with psycopg.connect(cs_ro, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            cur.execute("SELECT email, subject FROM veyra_safe.contact_messages WHERE id = %s", (id,))
            row = cur.fetchone()
        if not row:
            return {"ok": False, "error": "No such support message."}
        to, subj = row
        res = _post("emails", {"from": SENDERS["support"], "to": [to],
                               "subject": f"Re: {subj or 'Your message to Estoppel'}",
                               "html": _html(body), "reply_to": SUPPORT_ADDR})
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "send failed")}
        # Write with w role (UPDATE only on admin_reply, replied_at, status)
        with psycopg.connect(cs_w, sslmode="require", connect_timeout=20) as conn:
            conn.execute("UPDATE public.contact_messages SET admin_reply = %s, replied_at = now(), "
                         "status = 'replied' WHERE id = %s", (body, id))
            conn.commit()
        return {"ok": True, "id": id, "to": to}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("estoppel.support_acknowledge", Tier.CAUTION,
      "Mark one Estoppel support message as acknowledged without replying",
      network=True,
      summarize=lambda a: f"Acknowledge support message #{a.get('id')}")
def support_acknowledge(id: int = 0):
    cs_w = _pg_w()
    if not cs_w:
        return {"ok": False, "error": "Estoppel write DB not connected (estoppel_pg_w)."}
    try:
        import psycopg
        with psycopg.connect(cs_w, sslmode="require", connect_timeout=20) as conn:
            conn.execute(
                "UPDATE public.contact_messages SET status = 'acknowledged', replied_at = now() WHERE id = %s",
                (id,))
            conn.commit()
        return {"ok": True, "id": id, "status": "acknowledged"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("estoppel.support_bulk_close", Tier.DANGER,
      "Mark multiple Estoppel support messages as closed. Pass list of IDs.",
      network=True, risk="medium",
      summarize=lambda a: f"Close {len(a.get('ids', []))} support messages")
def support_bulk_close(ids: list = None, status: str = "resolved"):
    cs_w = _pg_w()
    if not cs_w:
        return {"ok": False, "error": "Estoppel write DB not connected (estoppel_pg_w)."}
    ids = [int(i) for i in (ids or []) if i]
    if not ids:
        return {"ok": False, "error": "Provide a list of message IDs."}
    allowed = {"resolved", "closed", "acknowledged", "replied"}
    status = status if status in allowed else "resolved"
    try:
        import psycopg
        placeholders = ",".join(["%s"] * len(ids))
        with psycopg.connect(cs_w, sslmode="require", connect_timeout=20) as conn:
            conn.execute(
                f"UPDATE public.contact_messages SET status = %s, replied_at = now() "
                f"WHERE id IN ({placeholders})",
                (status, *ids))
            conn.commit()
        return {"ok": True, "updated": len(ids), "status": status}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
