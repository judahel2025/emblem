// The heartbeat — a Cron Trigger fires every minute. Quiet by default:
//   • due automations run an agent turn AS their owner and file an alert
//   • calendar reminders become alerts at their lead time
// Discipline (from the blueprint): claim-before-run (no overlapping runs),
// catch-up-not-replay (a long sleep runs ONCE), quiet hours respected.

import type { Env } from "./env";
import { runAgent } from "./agent";
import { notify } from "./notifications";

function inQuietHours(now: Date, start: string, end: string): boolean {
  const [sh, sm] = (start || "22:00").split(":").map(Number);
  const [eh, em] = (end || "07:00").split(":").map(Number);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const s = sh * 60 + (sm || 0), e = eh * 60 + (em || 0);
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
}

export async function heartbeat(env: Env): Promise<void> {
  // ---- due automations ------------------------------------------------------
  const due = await env.DB.prepare(
    "SELECT a.id, a.user_id, a.instruction, a.every_secs, a.quiet_aware, " +
    "       p.quiet_start, p.quiet_end " +
    "FROM automations a LEFT JOIN profiles p ON p.user_id = a.user_id " +
    "WHERE a.enabled = 1 AND a.next_run <= datetime('now') LIMIT 10")
    .all<{ id: number; user_id: string; instruction: string; every_secs: number;
           quiet_aware: number; quiet_start: string | null; quiet_end: string | null }>();

  for (const a of due.results || []) {
    if (a.quiet_aware && inQuietHours(new Date(), a.quiet_start || "22:00", a.quiet_end || "07:00")) {
      continue; // hold until waking hours; stays due, picked up next tick after quiet ends
    }
    // Claim BEFORE running: reschedule from NOW (catch-up runs once, never stacks).
    const claim = await env.DB.prepare(
      "UPDATE automations SET next_run = datetime('now', '+' || every_secs || ' seconds'), " +
      "last_run = datetime('now') WHERE id = ? AND next_run <= datetime('now')")
      .bind(a.id).run();
    if (!claim.meta.changes) continue; // another tick claimed it

    let summary = "";
    try {
      const r = await runAgent(env, a.user_id, false, a.instruction, []);
      summary = (r.reply || "").slice(0, 500);
    } catch (e) {
      summary = `Automation failed: ${e instanceof Error ? e.message : e}`;
    }
    await env.DB.prepare(
      "UPDATE automations SET last_result = ? WHERE id = ?").bind(summary, a.id).run();
    await notify(env, a.user_id, "system", "automation", a.instruction.slice(0, 80), summary);
  }

  // ---- calendar reminders ----------------------------------------------------
  const reminders = await env.DB.prepare(
    "SELECT id, user_id, title, starts_at FROM calendar_events " +
    "WHERE remind_secs IS NOT NULL " +
    "AND datetime(starts_at, '-' || remind_secs || ' seconds') <= datetime('now') " +
    "AND starts_at > datetime('now') LIMIT 20")
    .all<{ id: number; user_id: string; title: string; starts_at: string }>();

  for (const r of reminders.results || []) {
    await notify(env, r.user_id, "system", "reminder", `Coming up: ${r.title}`, `Starts ${r.starts_at}`);
    // fire once: clear the lead time
    await env.DB.prepare("UPDATE calendar_events SET remind_secs = NULL WHERE id = ?")
      .bind(r.id).run();
  }
}
