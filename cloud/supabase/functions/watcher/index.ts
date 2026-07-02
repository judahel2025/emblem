// Veyra always-on watcher — runs on a Supabase cron.
// Reads Master Judah's products for new activity since the last cursor, records
// events in Veyra's cloud DB, and emails instant alerts via Resend. Owner-only.
//
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Set via `supabase secrets set`: RESEND_KEY, ALERT_TO, ESTOPPEL_DB_URL,
// QUANIAC_URL, QUANIAC_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const veyra = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RESEND_KEY = Deno.env.get("RESEND_KEY") ?? "";
const ALERT_TO = Deno.env.get("ALERT_TO") ?? "alliesjude@gmail.com";
const FROM = "Veyra Alerts <alerts@veyra.thequaniac.com>";

type Ev = { product: string; kind: string; severity?: string; title: string; detail?: unknown; occurred_at?: string };

async function cursor(source: string): Promise<string | null> {
  const { data } = await veyra.from("watch_cursors").select("last_seen_at").eq("source", source).maybeSingle();
  // first run: only look back 24h so we don't replay all history
  if (!data?.last_seen_at) return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return data.last_seen_at as string;
}
async function setCursor(source: string, ts: string) {
  await veyra.from("watch_cursors").upsert({ source, last_seen_at: ts, updated_at: new Date().toISOString() });
}
// Returns the new event id, or null if this row was already recorded (idempotent
// via external_id) — so the same signup/payment is never counted or emailed twice.
async function emit(ev: Ev): Promise<number | null> {
  const rid = (ev.detail as any)?.id;
  const external_id = rid != null ? `${ev.product}:${ev.kind}:${rid}` : null;
  const { data } = await veyra.from("events").upsert({
    product: ev.product, kind: ev.kind, severity: ev.severity ?? "info",
    title: ev.title, detail: ev.detail ?? {}, occurred_at: ev.occurred_at ?? new Date().toISOString(),
    external_id,
  }, { onConflict: "external_id", ignoreDuplicates: true }).select("id");
  return data && data.length ? data[0].id : null;
}
async function email(subject: string, text: string): Promise<string> {
  if (!RESEND_KEY) return "no-resend-key";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [ALERT_TO], subject, text }),
  });
  return r.ok ? "sent" : `resend ${r.status}`;
}

async function telegram(text: string): Promise<string> {
  const tok = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!tok || !chat) return "no-telegram";
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  return r.ok ? "sent" : `tg ${r.status}`;
}

// ---- Estoppel (Django Postgres) ----
async function checkEstoppel(found: Ev[]) {
  const url = Deno.env.get("ESTOPPEL_DB_URL");
  if (!url) return;
  const sql = postgres(url, { ssl: "require", max: 1, prepare: false });
  try {
    const sources: { source: string; kind: string; sev: string; q: (since: string) => Promise<any[]>; title: (r: any) => string }[] = [
      {
        source: "estoppel.payments", kind: "payment", sev: "success",
        q: (s) => sql`select id, amount, currency, status, created_at from payment_records where created_at > ${s} order by created_at`,
        title: (r) => `Estoppel payment: ${r.amount} ${r.currency} (${r.status})`,
      },
      {
        source: "estoppel.signups", kind: "signup", sev: "info",
        q: (s) => sql`select id, email, date_joined as created_at from users where date_joined > ${s} order by date_joined`,
        title: (r) => `New Estoppel user: ${r.email}`,
      },
      {
        source: "estoppel.contact", kind: "contact", sev: "warning",
        q: (s) => sql`select id, name, email, subject, created_at from contact_messages where created_at > ${s} order by created_at`,
        title: (r) => `Estoppel contact from ${r.name || r.email}: ${r.subject || "(no subject)"}`,
      },
    ];
    for (const src of sources) {
      const since = await cursor(src.source);
      let rows: any[] = [];
      try { rows = await src.q(since!); } catch (_e) { continue; }
      let maxTs = since!;
      for (const r of rows) {
        const id = await emit({ product: "estoppel", kind: src.kind, severity: src.sev, title: src.title(r), detail: r, occurred_at: new Date(r.created_at).toISOString() });
        if (id) found.push({ product: "estoppel", kind: src.kind, title: src.title(r) });
        const ts = new Date(r.created_at).toISOString();
        if (ts > maxTs) maxTs = ts;
      }
      if (rows.length) await setCursor(src.source, maxTs);
    }
  } finally {
    await sql.end();
  }
}

// ---- Quaniac (Supabase REST) ----
async function checkQuaniac(found: Ev[]) {
  const url = Deno.env.get("QUANIAC_URL");
  const key = Deno.env.get("QUANIAC_KEY");
  if (!url || !key) return;
  const q = createClient(url, key);
  const sources = [
    { source: "quaniac.newsletter", table: "newsletter_subscribers", kind: "signup", sev: "info", title: (r: any) => `New Quaniac subscriber: ${r.email}` },
    { source: "quaniac.contact", table: "chat_threads", kind: "contact", sev: "warning", title: (r: any) => `Quaniac chat started: ${r.visitor_name || r.visitor_email || "visitor"}` },
  ];
  for (const src of sources) {
    const since = await cursor(src.source);
    const { data: rows } = await q.from(src.table).select("*").gt("created_at", since!).order("created_at", { ascending: true });
    let maxTs = since!;
    for (const r of rows ?? []) {
      const id = await emit({ product: "quaniac", kind: src.kind, severity: src.sev, title: src.title(r), detail: r, occurred_at: new Date(r.created_at).toISOString() });
      if (id) found.push({ product: "quaniac", kind: src.kind, title: src.title(r) });
      const ts = new Date(r.created_at).toISOString();
      if (ts > maxTs) maxTs = ts;
    }
    if ((rows ?? []).length) await setCursor(src.source, maxTs);
  }
}

// Weekly/monthly digest from the event feed, with anomaly detection (big drops).
async function digest(period: string) {
  const days = period === "month" ? 30 : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const prevSince = new Date(Date.now() - 2 * days * 86400000).toISOString();
  const { data: cur } = await veyra.from("events").select("kind").gte("occurred_at", since);
  const { data: prev } = await veyra.from("events").select("kind").gte("occurred_at", prevSince).lt("occurred_at", since);
  const tally = (rows: any[]) => { const m: Record<string, number> = {}; for (const r of rows || []) m[r.kind] = (m[r.kind] || 0) + 1; return m; };
  const c = tally(cur || []), p = tally(prev || []);
  const kinds = [...new Set([...Object.keys(c), ...Object.keys(p)])];
  const lines: string[] = [], anomalies: string[] = [];
  for (const k of kinds) {
    const cv = c[k] || 0, pv = p[k] || 0;
    const pct = pv === 0 ? (cv > 0 ? "new" : "—") : `${cv >= pv ? "▲" : "▼"} ${Math.abs(Math.round((cv - pv) / pv * 100))}%`;
    lines.push(`• ${k}: ${cv} (${pct} vs prior ${period})`);
    if (pv >= 3 && cv <= pv * 0.5) anomalies.push(`${k} fell from ${pv} to ${cv}`);
  }
  for (const a of anomalies) {
    await veyra.from("events").insert({ product: "veyra", kind: "anomaly", severity: "warning", title: `Anomaly: ${a}`, detail: {} });
  }
  const body = `Master Judah — your ${period} digest:\n\n${lines.join("\n") || "No activity recorded."}`
    + (anomalies.length ? `\n\n⚠ Anomalies:\n${anomalies.map((a) => "• " + a).join("\n")}` : "")
    + "\n\n— Veyra";
  const mail = await email(`Veyra ${period} digest`, body);
  const tg = await telegram(body);
  return new Response(JSON.stringify({ ok: true, mode: "digest", period, lines, anomalies, mail, tg }), {
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("mode") === "digest") {
    return await digest(url.searchParams.get("period") || "week");
  }
  const found: Ev[] = [];
  const errors: string[] = [];
  try { await checkEstoppel(found); } catch (e) { errors.push("estoppel: " + (e as Error).message); }
  try { await checkQuaniac(found); } catch (e) { errors.push("quaniac: " + (e as Error).message); }

  // Only ping Master Judah for things that actually need him. Routine signups are
  // still recorded (briefing + digest) but don't trigger an email every cycle.
  const IMPORTANT = new Set(["payment", "contact", "anomaly"]);
  const important = found.filter((f) => IMPORTANT.has(f.kind));
  let mail = "skipped", tg = "skipped";
  if (important.length) {
    const lines = important.map((f) => `• [${f.product}] ${f.title}`).join("\n");
    const others = found.length - important.length;
    const extra = others > 0 ? `\n\nPlus ${others} routine update${others === 1 ? "" : "s"} (in your next digest).` : "";
    const text = `Master Judah — this needs your eyes:\n\n${lines}${extra}\n\n— Veyra`;
    mail = await email(`Veyra: ${important.length} update${important.length === 1 ? "" : "s"} need you`, text);
    tg = await telegram(text);
    for (const f of important) {
      await veyra.from("alerts").insert({ channel: "email", status: mail === "sent" ? "sent" : "failed", detail: f.title });
    }
  }
  return new Response(JSON.stringify({ ok: true, new_events: found.length, important: important.length, mail, tg, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
