// Native tool registrations. Importing this module populates the kernel registry.
// The agent (C5) adds more; these are the foundation + the DANGER-gate exemplar.

import { registerTool } from "./kernel";
import type { Env } from "./env";

registerTool({
  name: "notes.add",
  tier: "safe",
  description: "Save a note to the user's Notes",
  summarize: (a) => `Note: ${String(a.body ?? a.title ?? "").slice(0, 60)}`,
  handler: async (a, env, userId) => {
    const r = await env.DB.prepare(
      "INSERT INTO notes (title, body, color, user_id) VALUES (?, ?, 'default', ?)")
      .bind(String(a.title || ""), String(a.body || ""), userId).run();
    return { ok: true, id: r.meta.last_row_id };
  },
});

registerTool({
  name: "memory.save",
  tier: "safe",
  description: "Store a durable fact in the user's long-term memory",
  summarize: (a) => `Remember: ${String(a.content ?? "").slice(0, 60)}`,
  handler: async (a, env, userId) => {
    const content = String(a.content || "").trim();
    if (!content) return { ok: false, error: "Content is required." };
    const r = await env.DB.prepare(
      "INSERT INTO memory (kind, content, source, user_id) VALUES (?, ?, 'agent', ?)")
      .bind(String(a.kind || "fact"), content, userId).run();
    return { ok: true, id: r.meta.last_row_id };
  },
});

async function sendViaResend(env: Env, to: string, subject: string, body: string) {
  if (!env.RESEND_KEY || !env.RESEND_DOMAIN) {
    return { ok: false, error: "Email isn't configured yet." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Emblem <emblem@${env.RESEND_DOMAIN}>`,
      to: [to], subject: subject || "(no subject)",
      html: `<div style="font-family:sans-serif;font-size:14.5px;line-height:1.65">${
        (body || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`,
    }),
  });
  if (!res.ok) return { ok: false, error: `send failed (${res.status})` };
  const d = await res.json<{ id?: string }>().catch(() => ({} as { id?: string }));
  return { ok: true, id: d.id, to };
}

registerTool({
  name: "email.send_to",
  tier: "danger",
  description: "Send an email to a specific recipient",
  summarize: (a) => `Send email to ${a.to}: ${String(a.subject ?? "").slice(0, 50)}`,
  handler: (a, env) => sendViaResend(env, String(a.to || ""), String(a.subject || ""), String(a.body || "")),
});
