"""Mailroom — inbound email receive, storage, and notification."""

import logging
import os
import re

from ..kernel import data as db

_log = logging.getLogger("veyra.mailroom")


# --- Resend receiving API ----------------------------------------------------

def _resend_key() -> str:
    try:
        from ..kernel import vault
        k = vault.get_secret("resend_key")
        if k:
            return k
    except Exception:
        pass
    return os.environ.get("RESEND_KEY", os.environ.get("RESEND_API_KEY", ""))


def fetch_receiving_email(resend_email_id: str) -> dict:
    """GET /emails/receiving/{id} — returns full email with text + html body."""
    import httpx
    key = _resend_key()
    if not key:
        return {}
    try:
        r = httpx.get(
            f"https://api.resend.com/emails/receiving/{resend_email_id}",
            headers={"Authorization": f"Bearer {key}"},
            timeout=15,
        )
        if r.status_code == 200:
            return r.json()
    except Exception as exc:
        _log.warning("fetch_receiving_email(%s) failed: %s", resend_email_id, exc)
    return {}


def list_receiving_emails(limit: int = 100) -> list:
    """GET /emails/receiving — returns all received email summaries."""
    import httpx
    key = _resend_key()
    if not key:
        return []
    try:
        r = httpx.get(
            "https://api.resend.com/emails/receiving",
            headers={"Authorization": f"Bearer {key}"},
            params={"limit": limit},
            timeout=15,
        )
        if r.status_code == 200:
            return r.json().get("data", [])
    except Exception as exc:
        _log.warning("list_receiving_emails failed: %s", exc)
    return []


# --- High-water mark deduplication -------------------------------------------
# We track processed Resend email IDs in a simple config key so we never
# insert duplicates even when columns can't be added to the remote table.

_HWM_KEY = "resend_hwm_ids"   # stores a JSON list of the last 200 processed IDs


def _load_hwm() -> set:
    try:
        from ..kernel import config
        import json as _json
        raw = config.get(_HWM_KEY, "[]")
        return set(_json.loads(raw) if raw else [])
    except Exception:
        return set()


def _save_hwm(seen: set):
    try:
        from ..kernel import config
        import json as _json
        ids = list(seen)[-200:]
        config.set(_HWM_KEY, _json.dumps(ids))
    except Exception as exc:
        _log.warning("_save_hwm failed: %s", exc)


def mark_hwm(resend_id: str):
    """Mark a single Resend ID as processed so the poller won't re-insert it."""
    if not resend_id:
        return
    seen = _load_hwm()
    seen.add(resend_id)
    _save_hwm(seen)


# --- Storage & notifications --------------------------------------------------

def store_inbound(from_addr: str, to_addr: str, subject: str,
                  text_body: str, html_body: str = "") -> int:
    """Insert one inbound message and fire all notifications. Returns new id."""
    mid = db.write(
        "INSERT INTO mail_messages "
        "(direction, from_addr, to_addr, subject, text_body, html_body) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("inbound", from_addr[:500], to_addr[:500], subject[:1000],
         f"[untrusted] {text_body}", html_body[:50000]),
    )
    _notify(mid, from_addr, subject, text_body)
    return mid


def update_body(mid: int, text_body: str, html_body: str):
    db.write(
        "UPDATE mail_messages SET text_body = ?, html_body = ? WHERE id = ?",
        (f"[untrusted] {text_body}", html_body[:50000], mid),
    )


# --- Background poll (runs on server) ----------------------------------------

def poll_and_store() -> dict:
    """Pull new emails from Resend and store any not yet in the DB.

    Uses a high-water mark (set of processed Resend IDs stored in config) so
    each email is stored exactly once. Called every ~60 s by the background task.
    Returns counts of new emails stored.
    """
    emails = list_receiving_emails(50)   # newest 50
    if not emails:
        return {"new": 0}

    seen = _load_hwm()
    new_count = 0

    for summary in reversed(emails):    # oldest-first so DB order is chronological
        resend_id = summary.get("id", "")
        if not resend_id or resend_id in seen:
            seen.add(resend_id)
            continue

        # Fetch full content from Resend API
        full = fetch_receiving_email(resend_id)
        if not full:
            full = summary

        from_addr = full.get("from", "")
        to_field  = full.get("to", [])
        to_addr   = (to_field[0] if isinstance(to_field, list) else to_field) or ""
        subject   = full.get("subject", "")
        text_body = full.get("text", "") or ""
        html_body = full.get("html", "") or ""

        # Derive plain text from HTML when only HTML arrived
        if not text_body and html_body:
            text_body = re.sub(r"<[^>]+>", " ", html_body)
            text_body = re.sub(r"\s{2,}", " ", text_body).strip()

        if not from_addr:
            seen.add(resend_id)
            continue

        # HWM is the sole deduplication mechanism — no from+subject check.
        # (That check caused legitimate follow-up emails with the same subject to be dropped.)
        mid = store_inbound(from_addr, to_addr, subject, text_body, html_body)
        seen.add(resend_id)
        new_count += 1
        _log.info("poll: stored mid=%d resend_id=%s from=%s subject=%r",
                  mid, resend_id, from_addr, subject)

    _save_hwm(seen)
    return {"new": new_count}


def sync_from_resend() -> dict:
    """Full backfill: pull all emails, update bodies for existing rows, insert new ones.
    Skips alerts/speech (backfill only). Use poll_and_store() for live ingestion.
    """
    emails = list_receiving_emails(100)
    seen   = _load_hwm()
    new_count = 0

    for summary in emails:
        resend_id = summary.get("id", "")
        if not resend_id:
            continue

        full = fetch_receiving_email(resend_id)
        if not full:
            full = summary

        from_addr = full.get("from", "")
        to_field  = full.get("to", [])
        to_addr   = (to_field[0] if isinstance(to_field, list) else to_field) or ""
        subject   = full.get("subject", "")
        text_body = full.get("text", "") or ""
        html_body = full.get("html", "") or ""

        if not text_body and html_body:
            text_body = re.sub(r"<[^>]+>", " ", html_body)
            text_body = re.sub(r"\s{2,}", " ", text_body).strip()

        if resend_id in seen:
            continue

        mid = db.write(
            "INSERT INTO mail_messages "
            "(direction, from_addr, to_addr, subject, text_body, html_body) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("inbound", from_addr[:500], to_addr[:500], subject[:1000],
             f"[untrusted] {text_body}", html_body[:50000]),
        )
        new_count += 1

        seen.add(resend_id)

    _save_hwm(seen)
    return {"synced": len(emails), "new": new_count}


def _notify(mid: int, from_addr: str, subject: str, text_body: str):
    """Voice announcement + in-app alert for a new inbound email.
    email=False: never burn Resend outbound quota for inbound notifications.
    """
    _speak_async(from_addr, subject)
    try:
        from .. import alerts
        alerts.raise_alert(
            kind="mail",
            title=f"New mail from {from_addr}",
            body=f"{subject or '(no subject)'} — {text_body[:200]}",
            data={"mail_id": mid, "from": from_addr, "subject": subject},
            email=False,
        )
    except Exception as exc:
        _log.warning("_notify alert failed (non-fatal): %s", exc)
    _forward_async(mid, from_addr, subject, text_body)


def _speak_async(from_addr: str, subject: str):
    import threading
    def _say():
        try:
            from ..voice import service
            name = from_addr.split("@")[0].replace(".", " ").replace("_", " ")
            text = f"New email from {name}. Subject: {subject or 'no subject'}."
            service.tts(text)
        except Exception:
            pass
    threading.Thread(target=_say, daemon=True).start()


def _forward_async(mid: int, from_addr: str, subject: str, text_body: str):
    """Forward a summary of the inbound email to alliesjude@gmail.com via Resend."""
    import threading
    def _send():
        try:
            key = _resend_key()
            if not key:
                return
            import httpx
            snippet = text_body[:400].replace("\n", " ").strip()
            html = (
                f'<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">'
                f'<p><strong>New mail in Veyra inbox</strong></p>'
                f'<p><strong>From:</strong> {from_addr}<br>'
                f'<strong>Subject:</strong> {subject or "(no subject)"}</p>'
                f'<p style="background:#f5f5f5;padding:12px;border-radius:4px">{snippet}</p>'
                f'<p style="color:#888;font-size:12px">Mail ID #{mid} &middot; Open Veyra to read and reply</p>'
                f'</div>'
            )
            httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "from": "Veyra <veyra@thequaniac.com>",
                    "to": ["alliesjude@gmail.com"],
                    "subject": f"[Veyra] New mail: {subject or '(no subject)'}",
                    "html": html,
                },
                timeout=15,
            )
        except Exception as exc:
            _log.warning("_forward_async failed (non-fatal): %s", exc)
    threading.Thread(target=_send, daemon=True).start()


# --- Listing & queries -------------------------------------------------------

def listing(status: str = "unread", limit: int = 50) -> list:
    limit = max(1, min(int(limit), 200))
    cols = ("id, direction, from_addr, to_addr, subject, text_body, html_body, "
            "status, received_at, created_at")
    if status == "all":
        return db.query(
            f"SELECT {cols} FROM mail_messages ORDER BY id DESC LIMIT ?", (limit,)
        )
    return db.query(
        f"SELECT {cols} FROM mail_messages WHERE status = ? ORDER BY id DESC LIMIT ?",
        (status, limit)
    )


def get_one(mid: int) -> dict | None:
    return db.one("SELECT * FROM mail_messages WHERE id = ?", (mid,))


def mark_read(mid: int) -> bool:
    db.write(
        "UPDATE mail_messages SET status = 'read' WHERE id = ? AND status = 'unread'", (mid,)
    )
    return True


def archive(mid: int) -> bool:
    db.write("UPDATE mail_messages SET status = 'archived' WHERE id = ?", (mid,))
    return True


def unread_count() -> int:
    row = db.one("SELECT count(*) AS n FROM mail_messages WHERE status = 'unread'")
    return (row.get("n") or 0) if row else 0


def bulk_mark_read(ids: list) -> int:
    """Mark a list of message IDs as read. Returns count updated."""
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    db.write(
        f"UPDATE mail_messages SET status = 'read' WHERE id IN ({placeholders}) AND status = 'unread'",
        tuple(ids),
    )
    return len(ids)


def bulk_archive(ids: list) -> int:
    """Archive a list of message IDs. Returns count updated."""
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    db.write(
        f"UPDATE mail_messages SET status = 'archived' WHERE id IN ({placeholders})",
        tuple(ids),
    )
    return len(ids)
