// Proactive grounding, ONE accurate, real-signal line, surfaced when the user
// opens the app (not a timer, never a nag). Reads what's actually connected:
// today's next calendar event + unread email + a fresh GitHub PR, and composes a
// grounded sentence. Everything is best-effort with short timeouts so app-open
// never blocks; if there's nothing real to say, it returns an empty line.

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

function fmtTime(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  let h = parseInt(m[1], 10); const min = m[2];
  const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return `${h}${min === "00" ? "" : ":" + min}${ap}`;
}

export async function proactiveBriefing(env: Env, userId: string): Promise<{ line: string }> {
  let active: string[] = [];
  try { active = (await connectionStates(env, userId)).active; } catch { /* none */ }
  if (!active.length) return { line: "" };

  const bits: string[] = [];

  // Next calendar event today.
  if (active.includes("googlecalendar")) {
    const end = new Date(); end.setUTCHours(23, 59, 59, 0);
    const res = await withTimeout(executeComposio(env, userId, "GOOGLECALENDAR_EVENTS_LIST", {
      timeMin: new Date().toISOString(), timeMax: end.toISOString(),
      maxResults: 5, singleEvents: true, orderBy: "startTime",
    }), 3500);
    const events = asArray(res);
    const next = events.find((e) => {
      const s = (e as { start?: { dateTime?: string; date?: string } }).start;
      return s?.dateTime || s?.date;
    }) as { summary?: string; start?: { dateTime?: string } } | undefined;
    if (next?.summary) {
      const t = next.start?.dateTime ? fmtTime(next.start.dateTime) : "";
      bits.push(`you've got “${next.summary}”${t ? ` at ${t}` : " today"}`);
    }
  }

  // Unread email.
  if (active.includes("gmail")) {
    const res = await withTimeout(executeComposio(env, userId, "GMAIL_FETCH_EMAILS",
      { query: "is:unread in:inbox", max_results: 5 }), 3500);
    const msgs = asArray(res);
    if (msgs.length) {
      const top = msgs[0] as { sender?: string; from?: string };
      const who = String(top.sender || top.from || "").match(/^"?([^"<]*?)"?\s*</)?.[1]?.trim();
      bits.push(msgs.length === 1
        ? `one unread email${who ? ` from ${who}` : ""}`
        : `${msgs.length}${msgs.length >= 5 ? "+" : ""} unread emails${who ? `, latest from ${who}` : ""}`);
    }
  }

  if (!bits.length) return { line: "" };
  const joined = bits.length === 1 ? bits[0] : bits.slice(0, -1).join(", ") + " and " + bits.at(-1);
  const line = `Quick heads-up, ${joined}. Want me to help with any of it?`;
  return { line };
}
