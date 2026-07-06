// Notifications, connector activity captured into a per-user feed. Polled on a
// throttle (client triggers it while the app is open; cron also feeds it), with a
// baseline so the FIRST check of an account doesn't flood the feed with every
// existing unread email. New items after baseline become unread notifications
// (badge + Chrome popup); the Notifications page is the single home for all of it.

import type { Env } from "./env";
import { connectionStates, executeComposio } from "./composio";

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const o = v as Record<string, unknown> | null;
  for (const k of ["items", "messages", "events", "data", "result"]) {
    const inner = o?.[k];
    if (Array.isArray(inner)) return inner;
    if (inner && typeof inner === "object") {
      for (const k2 of ["items", "messages", "events"]) {
        if (Array.isArray((inner as Record<string, unknown>)[k2])) return (inner as Record<string, unknown>)[k2] as unknown[];
      }
    }
  }
  return [];
}
function senderName(s: unknown): string {
  const str = String(s || "").trim();
  const m = str.match(/^"?([^"<]*?)"?\s*</);
  return (m && m[1].trim()) || str.replace(/[<>]/g, "") || "someone";
}
function fmtTime(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  let h = parseInt(m[1], 10); const min = m[2];
  const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return `${h}${min === "00" ? "" : ":" + min}${ap}`;
}

export interface Notif { id: number; app: string; kind: string; title: string; body: string; ref?: string }

/** INSERT OR IGNORE one notification. Returns the row if it was actually new. */
async function insert(env: Env, userId: string, app: string, kind: string, title: string,
                      body: string, ref: string | null, read: number): Promise<Notif | null> {
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO notifications (user_id, app, kind, title, body, ref, read) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(userId, app, kind, title, body, ref, read).run();
  if (!r.meta.changes) return null;
  return { id: r.meta.last_row_id as number, app, kind, title, body, ref: ref ?? undefined };
}

async function baselined(env: Env, userId: string, app: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 FROM connector_watermarks WHERE user_id = ? AND app = ?").bind(userId, app).first();
  return Boolean(row);
}
async function markChecked(env: Env, userId: string, app: string) {
  await env.DB.prepare(
    "INSERT INTO connector_watermarks (user_id, app, last_checked) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(user_id, app) DO UPDATE SET last_checked = datetime('now')").bind(userId, app).run();
}

/** Poll a user's connectors for new activity → notifications. Throttled to ~90s.
 *  Returns the NEW unread notifications (for the client to pop as Chrome alerts). */
export async function pollNotifications(env: Env, userId: string): Promise<Notif[]> {
  // global throttle across apps
  const gate = await env.DB.prepare(
    "SELECT last_checked FROM connector_watermarks WHERE user_id = ? AND app = '_poll'")
    .bind(userId).first<{ last_checked: string }>();
  if (gate && Date.now() - Date.parse(gate.last_checked.replace(" ", "T") + "Z") < 90_000) return [];
  await markChecked(env, userId, "_poll");

  let active: string[] = [];
  try { active = (await connectionStates(env, userId)).active; } catch { return []; }
  const fresh: Notif[] = [];

  // ── Gmail: new unread ──
  if (active.includes("gmail")) {
    const seen = await baselined(env, userId, "gmail");
    const res = await withTimeout(executeComposio(env, userId, "GMAIL_FETCH_EMAILS",
      { query: "is:unread in:inbox", max_results: 10 }), 4000);
    for (const m of asArray(res)) {
      const msg = m as Record<string, unknown>;
      const id = String(msg.messageId || msg.id || "");
      if (!id) continue;
      const from = senderName(msg.sender || msg.from);
      const preview = (msg.preview as { subject?: string } | undefined)?.subject;
      const subj = String(msg.subject || preview || "(no subject)").slice(0, 140);
      const n = await insert(env, userId, "gmail", "mail", `New email from ${from}`, subj, id, seen ? 0 : 1);
      if (n && seen) fresh.push(n);
    }
    await markChecked(env, userId, "gmail");
  }

  // ── Calendar: events starting soon ──
  if (active.includes("googlecalendar")) {
    const end = new Date(Date.now() + 60 * 60 * 1000);   // next hour
    const res = await withTimeout(executeComposio(env, userId, "GOOGLECALENDAR_EVENTS_LIST",
      { timeMin: new Date().toISOString(), timeMax: end.toISOString(),
        maxResults: 5, singleEvents: true, orderBy: "startTime" }), 4000);
    for (const e of asArray(res)) {
      const ev = e as { id?: string; summary?: string; start?: { dateTime?: string } };
      const id = String(ev.id || "");
      if (!id || !ev.summary) continue;
      const t = ev.start?.dateTime ? fmtTime(ev.start.dateTime) : "soon";
      const n = await insert(env, userId, "googlecalendar", "event",
        `Coming up: ${ev.summary}`, `Starts ${t}`, id, 0);
      if (n) fresh.push(n);
    }
    await markChecked(env, userId, "googlecalendar");
  }

  return fresh;
}

/** Add a system notification (automations, reminders, alerts). */
export async function notify(env: Env, userId: string, app: string, kind: string, title: string, body: string) {
  await insert(env, userId, app, kind, title, body, null, 0);
}

export async function listNotifications(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, app, kind, title, body, read, created_at FROM notifications " +
    "WHERE user_id = ? ORDER BY id DESC LIMIT 100").bind(userId).all();
  const c = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0")
    .bind(userId).first<{ n: number }>();
  return { items: rows.results || [], unread: c?.n || 0 };
}
