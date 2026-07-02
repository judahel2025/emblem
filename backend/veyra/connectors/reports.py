"""Report engine — weekly/monthly statistics reports. Builds a rich summary from the
analytics engine, emails it (HTML) from reports@, saves a Markdown doc to Files, and
archives it in the Veyra cloud reports table. On-demand or scheduled.
"""

from datetime import datetime, timezone

from .. import kernel
from ..kernel import Tier, tool, vault

E_LABELS = {"signups": "New signups", "active_users": "Active users", "prompts": "AI prompts",
            "credits_used": "Credits used", "payments": "Payments", "revenue": "Revenue", "total_users": "Total users"}
Q_LABELS = {"visits": "Visits", "unique_visitors": "Unique visitors", "blog_reads": "Blog reads",
            "subscribers": "New subscribers", "contact_chats": "Contact chats"}
VS = {"day": "yesterday", "week": "last week", "month": "last month"}


def _delta_str(m):
    if not isinstance(m, dict):
        return ""
    if m.get("is_new"):
        return "NEW"
    p = m.get("change_pct")
    if p is None:
        return "—"
    arrow = "▲" if m.get("direction") == "up" else ("▼" if m.get("direction") == "down" else "→")
    return f"{arrow} {abs(p)}%"


def _rows(section, labels):
    if not section or section.get("configured") is False:
        return []
    m = section.get("metrics", {})
    return [(labels[k], m[k]) for k in labels if isinstance(m.get(k), dict) and "current" in m[k]]


def _html(rep, period):
    vs = VS.get(period, "prior period")
    def table(title, sub, rows):
        if not rows:
            return f"<h3 style='margin:22px 0 6px'>{title} <span style='color:#888;font-weight:400'>· {sub}</span></h3><p style='color:#888'>Not connected.</p>"
        trs = ""
        for label, m in rows:
            d = _delta_str(m)
            color = "#16a34a" if m.get("direction") == "up" else ("#dc2626" if m.get("direction") == "down" else "#888")
            trs += (f"<tr><td style='padding:7px 10px;border-bottom:1px solid #eee'>{label}</td>"
                    f"<td style='padding:7px 10px;border-bottom:1px solid #eee;font-weight:700;text-align:right'>{m.get('current')}</td>"
                    f"<td style='padding:7px 10px;border-bottom:1px solid #eee;text-align:right;color:{color};font-weight:600'>{d}</td>"
                    f"<td style='padding:7px 10px;border-bottom:1px solid #eee;text-align:right;color:#999'>{m.get('previous','')}</td></tr>")
        return (f"<h3 style='margin:22px 0 6px'>{title} <span style='color:#888;font-weight:400'>· {sub}</span></h3>"
                f"<table style='border-collapse:collapse;width:100%;font-size:14px'>"
                f"<tr style='color:#888;font-size:12px;text-transform:uppercase'><td style='padding:6px 10px'>Metric</td>"
                f"<td style='padding:6px 10px;text-align:right'>Now</td><td style='padding:6px 10px;text-align:right'>Δ vs {vs}</td>"
                f"<td style='padding:6px 10px;text-align:right'>Was</td></tr>{trs}</table>")
    est = table("Estoppel", "legal AI", _rows(rep.get("estoppel"), E_LABELS))
    qua = table("Quaniac", "company site", _rows(rep.get("quaniac"), Q_LABELS))
    bd = rep.get("estoppel", {}).get("breakdowns", {}).get("prompts_by_model") or []
    bd_html = ""
    if bd:
        items = "".join(f"<li>{r['model']}: <b>{r['count']}</b></li>" for r in bd)
        bd_html = f"<h3 style='margin:22px 0 6px'>AI usage by model</h3><ul style='font-size:14px;color:#333'>{items}</ul>"
    return (f"<div style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px'>"
            f"<h2 style='margin:0 0 4px'>Veyra {period.capitalize()} Report</h2>"
            f"<p style='color:#888;margin:0 0 8px'>{datetime.now().strftime('%B %d, %Y')}</p>"
            f"{est}{qua}{bd_html}"
            f"<p style='color:#aaa;font-size:12px;margin-top:24px'>— Veyra · automated report</p></div>")


def _text(rep, period):
    lines = [f"Veyra {period.capitalize()} Report", ""]
    for name, sect, labels in [("Estoppel", rep.get("estoppel"), E_LABELS), ("Quaniac", rep.get("quaniac"), Q_LABELS)]:
        lines.append(f"## {name}")
        for label, m in _rows(sect, labels):
            lines.append(f"- {label}: {m.get('current')} ({_delta_str(m)} vs {VS.get(period)}, was {m.get('previous')})")
        lines.append("")
    return "\n".join(lines)


@tool("reports.generate", Tier.SAFE, "Generate a weekly/monthly stats report, email it, and archive it", network=True)
def generate(period="week"):
    period = (period or "week").lower()
    rep = kernel.execute_tool("analytics.report", {"period": period}, actor="agent")
    if not rep.get("ok"):
        return {"ok": False, "error": "analytics unavailable"}
    html = _html(rep, period)
    text = _text(rep, period)
    title = f"Veyra {period.capitalize()} Report — {datetime.now().strftime('%b %d, %Y')}"

    doc = kernel.execute_tool("docs.write", {"title": title, "content": text, "fmt": "md"}, actor="agent")
    em = kernel.execute_tool("email.send", {"subject": title, "html": html, "purpose": "report"}, actor="agent")

    archived = False
    try:
        import psycopg, json
        ci = vault.get_secret("veyra_pg")
        if ci:
            with psycopg.connect(ci, sslmode="require", connect_timeout=20, autocommit=True) as conn:
                conn.execute("insert into public.reports (period, title, summary, data, document_path) values (%s,%s,%s,%s,%s)",
                             (period, title, text[:1000], json.dumps(rep, default=str), doc.get("path")))
            archived = True
    except Exception:
        pass
    return {"ok": True, "period": period, "emailed": em.get("ok"), "doc": doc.get("path"), "archived": archived}
