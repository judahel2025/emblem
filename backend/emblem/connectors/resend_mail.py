"""Resend email connector — Emblem sends real, branded email.

Two clearly-separated paths:
  • email.send  — OWNER-ONLY. Always delivers to the vaulted alert_to address. Used for
    alerts, reports, and emailing the owner their own generated documents. An injected
    instruction can never redirect it.
  • send_to()   — internal helper for an explicit, human-initiated send to a given address
    (the Inbox "Send" button). Not exposed as an agent tool, so the model can't silently
    email third parties; the owner clicks Send.

All mail is wrapped in a branded Emblem HTML template. Attachments supported.
"""

import base64
import os

from ..kernel import Tier, tool, vault
from ..tools import fsutil

# Configure via RESEND_DOMAIN (a domain verified in the Resend dashboard) and
# EMBLEM_ALERT_TO (where owner alerts go). No hardcoded defaults — unset = sending off.
DEFAULT_DOMAIN = os.environ.get("RESEND_DOMAIN", "")
DEFAULT_TO = os.environ.get("EMBLEM_ALERT_TO", "")

SENDERS = {
    "alert": ("Emblem Alerts", "alerts"), "report": ("Emblem Reports", "reports"),
    "briefing": ("Emblem", "briefing"), "security": ("Emblem Security", "security"),
    "billing": ("Emblem Billing", "billing"), "system": ("Emblem", "noreply"),
    "default": ("Emblem", "emblem"),
}


def _domain():
    return vault.get_secret("resend_domain") or DEFAULT_DOMAIN


def _from(purpose):
    name, local = SENDERS.get(purpose, SENDERS["default"])
    return f"{name} <{local}@{_domain()}>"


def _brand_wrap(subject, inner_html):
    return (
        '<div style="background:#f4f1ec;padding:26px 12px;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e7e1d6;border-radius:18px;overflow:hidden">'
        '<div style="padding:16px 24px;background:#100904">'
        '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ffedd7;'
        'vertical-align:middle"></span>'
        '<span style="color:#ffedd7;font-weight:500;letter-spacing:.3px;margin-left:10px;vertical-align:middle">emblem</span>'
        '</div>'
        f'<div style="padding:24px;color:#1f1a14;font-size:14.5px;line-height:1.65">{inner_html}</div>'
        '<div style="padding:13px 24px;border-top:1px solid #eee;color:#9a9388;font-size:11px">'
        f'Sent by Emblem · {_domain() or "emblem"}</div>'
        '</div></div>'
    )


def _text_to_html(text):
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return safe.replace("\n", "<br>")


def _attachments(paths):
    out = []
    for p in paths or []:
        try:
            fp = fsutil.resolve("documents", p) if not str(p).replace("\\", "/").startswith("/") else p
            with open(fp, "rb") as f:
                out.append({"filename": str(p).split("/")[-1].split("\\")[-1],
                            "content": base64.b64encode(f.read()).decode()})
        except Exception:
            pass
    return out


_PLACEHOLDER_DOMAINS = {"example.com", "example.org", "example.net", "test.com", "placeholder.com"}


def _validate_recipient(to: str) -> str | None:
    """Return an error string if the address is a known placeholder, else None."""
    if not to or "@" not in to:
        return "A valid recipient address is required."
    domain = to.split("@")[-1].lower().strip()
    if domain in _PLACEHOLDER_DOMAINS:
        return (
            f"'{to}' is a placeholder address — not a real inbox. "
            f""
            f"Please confirm the correct recipient before sending."
        )
    return None


def send_to(to, subject="", body="", html=None, attachments=None, purpose="default"):
    """Send to an explicit recipient (used by the human-initiated Inbox Send)."""
    err = _validate_recipient(to)
    if err:
        return {"ok": False, "error": err}
    key = vault.get_secret("resend_key")
    if not key:
        return {"ok": False, "configured": False, "error": "Resend isn't connected yet."}
    inner = html or _text_to_html(body)
    payload = {"from": _from(purpose), "to": [to], "subject": subject or "(no subject)",
               "html": _brand_wrap(subject, inner)}
    atts = _attachments(attachments)
    if atts:
        payload["attachments"] = atts
    try:
        import httpx
        r = httpx.post("https://api.resend.com/emails",
                       headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                       json=payload, timeout=30)
        if r.status_code >= 300:
            return {"ok": False, "error": f"Resend {r.status_code}: {r.text[:200]}"}
        return {"ok": True, "id": (r.json() or {}).get("id"), "to": to}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("email.send", Tier.SAFE,
      "Email the owner (owner-only; alerts, reports, or attach a generated document)",
      network=True)
def send(subject="", body="", html=None, purpose="alert", attachments=None):
    to = vault.get_secret("alert_to") or DEFAULT_TO
    return send_to(to, subject=subject, body=body, html=html, attachments=attachments, purpose=purpose)


@tool("email.send_to", Tier.DANGER,
      "Send an email to a specific recipient (gated: confirm or full-auto mode)",
      network=True, risk="high",
      summarize=lambda a: f"Send email to {a.get('to', '')}: {a.get('subject', '')[:50]}",
      target=lambda a: a.get("to", ""))
def send_to_recipient(to="", subject="", body="", attachments=None):
    if not (to or "").strip():
        return {"ok": False, "error": "A recipient address is required."}
    res = send_to(to, subject=subject, body=body, attachments=attachments, purpose="default")
    if res.get("ok"):
        # mirror into the Inbox as a sent record for the history view
        try:
            from ..tools import emails
            eid = emails.add_draft(to, subject, body).get("id")
            if eid:
                emails.mark_sent(eid)
        except Exception:
            pass
    return res
