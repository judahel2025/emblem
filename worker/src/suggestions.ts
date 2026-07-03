// Personalized workflow suggestions — a second brain that reads what onboarding
// (and ongoing memory) learned about the user and proposes concrete next moves:
// automations to set up, apps to connect, things to ask Emblem right now.
// Cached per-user for 24h in kernel_config; regenerated on demand after
// onboarding completes or when connections change.

import type { Env } from "./env";
import { poolChat } from "./brainpool";
import { listConnections } from "./composio";

const SUGGESTER =
  "You design personalized workflow suggestions for a member of Emblem — an AI " +
  "workspace that can: chat and answer anything; send email from THEIR connected Gmail; " +
  "manage their Google Calendar; browse/edit/push code in their GitHub; post to their " +
  "LinkedIn/X/Instagram/Facebook; use their Notion and Slack; keep Pages (living " +
  "documents); set plain-language Automations that run on a schedule (e.g. every " +
  "morning); and remember durable facts.\n\n" +
  "Given the member's profile facts and which apps they have connected, reply with ONLY " +
  "a JSON object {\"suggestions\": [...]} of 4 to 6 items. Each item: " +
  "{\"icon\": one of [mail, calendar, code, notes, bolt, share, mic, plug], " +
  "\"title\": 3-6 words, " +
  "\"line\": one warm sentence explaining WHY this fits them specifically (reference " +
  "their actual work/needs), " +
  "\"command\": the exact message the member would send Emblem to do it}.\n" +
  "Rules: suggestions must be concretely tied to their profile — never generic filler. " +
  "If a suggestion needs an app they haven't connected, the command should ask Emblem " +
  "to help connect it. At least one suggestion should be an Automation. Never mention " +
  "AI models or providers.";

// Models occasionally emit mojibake (UTF-8 read as Latin-1: "â€¯" etc.) and
// exotic whitespace — normalize so cards never show garbage.
const clean = (s: string) =>
  s.replace(/â€[¯‘’“”†]?|Ã¢| |‑|�/g, " ").replace(/\s+/g, " ").trim();

export async function getSuggestions(env: Env, userId: string, force = false):
    Promise<Array<Record<string, string>>> {
  const cacheKey = `suggestions:${userId}`;
  if (!force) {
    const row = await env.DB.prepare(
      "SELECT value FROM kernel_config WHERE key = ?").bind(cacheKey)
      .first<{ value: string }>();
    if (row?.value) {
      try {
        const c = JSON.parse(row.value) as { at: number; items: Array<Record<string, string>> };
        if (Date.now() - c.at < 24 * 3600 * 1000 && c.items?.length) return c.items;
      } catch { /* regenerate */ }
    }
  }

  const [profile, mem, connected] = await Promise.all([
    env.DB.prepare("SELECT display_name, role, tone FROM profiles WHERE user_id = ?")
      .bind(userId).first<{ display_name: string; role: string; tone: string }>(),
    env.DB.prepare(
      "SELECT content FROM memory WHERE user_id = ? ORDER BY id DESC LIMIT 25")
      .bind(userId).all<{ content: string }>(),
    listConnections(env, userId),
  ]);

  const facts = (mem.results || []).map((m) => `- ${m.content}`).join("\n");
  const r = await poolChat(env, [
    { role: "system", content: SUGGESTER },
    { role: "user", content:
      `Member profile:\nName: ${profile?.display_name || "unknown"}\nRole: ${profile?.role || "unknown"}\n` +
      `Facts:\n${facts || "- (nothing yet — suggest getting-started moves)"}\n` +
      `Connected apps: ${connected.length ? connected.join(", ") : "none yet"}` },
  ], { maxTokens: 900, temperature: 0.7, json: true });

  let items: Array<Record<string, string>> = [];
  try {
    const raw = (r?.content || "{}").replace(/^```(json)?|```$/g, "").trim();
    const parsed = JSON.parse(raw) as { suggestions?: Array<Record<string, string>> };
    items = (parsed.suggestions || [])
      .filter((s) => s && s.title && s.command)
      .slice(0, 6)
      .map((s) => ({
        icon: clean(String(s.icon || "bolt")),
        title: clean(String(s.title)).slice(0, 60),
        line: clean(String(s.line || "")).slice(0, 160),
        command: clean(String(s.command)).slice(0, 300),
      }));
  } catch { /* empty */ }

  if (items.length) {
    await env.DB.prepare(
      "INSERT INTO kernel_config (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(cacheKey, JSON.stringify({ at: Date.now(), items })).run();
  }
  return items;
}
