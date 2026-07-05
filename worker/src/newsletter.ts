// Newsletters — opt-in only. Recipient set = opted-in members UNION landing
// subscribers. Every email carries a working HMAC-signed unsubscribe link that
// the server appends (the drafting model can never omit it). Sending uses
// Resend's batch endpoint (≤100/call) to stay under the Workers subrequest cap.

import type { Env } from "./env";
import { b64url } from "./lib/crypto";
import { poolChat, type ChatMsg } from "./brainpool";

const enc = new TextEncoder();

// ---- unsubscribe tokens (HMAC-SHA256 over the email; nothing stored) ---------

async function hmac(env: Env, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.JWT_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export async function unsubSig(env: Env, email: string): Promise<string> {
  return hmac(env, "unsub:" + email.trim().toLowerCase());
}

export async function verifyUnsubSig(env: Env, email: string, sig: string): Promise<boolean> {
  const expect = await unsubSig(env, email);
  if (expect.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function unsubUrl(env: Env, email: string): Promise<string> {
  const origin = env.APP_ORIGIN || "https://emblem.thequaniac.com";
  const e = b64url(email.trim().toLowerCase());
  const sig = await unsubSig(env, email);
  return `${origin}/api/newsletter/unsub?e=${e}&sig=${sig}`;
}

// ---- sending ------------------------------------------------------------------

function withFooter(html: string, unsub: string): string {
  return `${html}
<div style="max-width:600px;margin:28px auto 0;padding:14px 0;border-top:1px solid #ddd;
  font-family:sans-serif;font-size:12px;color:#8a8a8a;text-align:center">
  You're receiving this because you subscribed to Emblem updates.
  <a href="${unsub}" style="color:#8a8a8a">Unsubscribe</a>
</div>`;
}

// Real-HTML sender (sendViaResend HTML-escapes its body, so newsletters need this).
export async function sendNewsletterEmail(env: Env, to: string, subject: string, html: string):
    Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_KEY || !env.RESEND_DOMAIN) return { ok: false, error: "Email isn't configured yet." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Emblem <emblem@${env.RESEND_DOMAIN}>`,
      to: [to],
      subject: subject || "(no subject)",
      html: withFooter(html, await unsubUrl(env, to)),
    }),
  });
  if (!res.ok) {
    // Surface Resend's real message — "domain not verified" must reach the admin verbatim.
    const body = await res.text().catch(() => "");
    let msg = `send failed (${res.status})`;
    try { msg = (JSON.parse(body) as { message?: string }).message || msg; } catch {}
    return { ok: false, error: msg };
  }
  return { ok: true };
}

// ---- recipients -----------------------------------------------------------------

export async function recipientList(env: Env): Promise<{ members: string[]; subscribers: string[] }> {
  const m = await env.DB.prepare(
    `SELECT u.email FROM users u JOIN profiles p ON p.user_id = u.id
     WHERE p.newsletter_opt = 1`).all<{ email: string }>();
  const s = await env.DB.prepare(
    `SELECT email FROM subscribers WHERE opted = 1`).all<{ email: string }>();
  const members = (m.results || []).map((r) => r.email.toLowerCase());
  const memberSet = new Set(members);
  const subs = (s.results || []).map((r) => r.email.toLowerCase())
    .filter((e) => !memberSet.has(e));
  return { members, subscribers: subs };
}

export async function sendNewsletter(env: Env, subject: string, html: string):
    Promise<{ sent: number; failed: number; results: Array<{ to: string; ok: boolean; error?: string }> }> {
  if (!env.RESEND_KEY || !env.RESEND_DOMAIN) {
    return { sent: 0, failed: 0, results: [{ to: "(all)", ok: false, error: "Email isn't configured yet." }] };
  }
  const { members, subscribers } = await recipientList(env);
  const all = [...members, ...subscribers];
  const results: Array<{ to: string; ok: boolean; error?: string }> = [];

  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const payload = await Promise.all(batch.map(async (to) => ({
      from: `Emblem <emblem@${env.RESEND_DOMAIN}>`,
      to: [to],
      subject: subject || "(no subject)",
      html: withFooter(html, await unsubUrl(env, to)),
    })));
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let msg = `batch failed (${res.status})`;
      try { msg = (JSON.parse(body) as { message?: string }).message || msg; } catch {}
      for (const to of batch) results.push({ to, ok: false, error: msg });
      continue;
    }
    for (const to of batch) results.push({ to, ok: true });
  }
  const sent = results.filter((r) => r.ok).length;
  return { sent, failed: results.length - sent, results };
}

// ---- the admin AI drafting channel ------------------------------------------------

const NEWSLETTER_WRITER =
  "You are Emblem's newsletter editor, working with the product owner on a single email " +
  "newsletter. Discuss, propose, and revise until the owner is happy.\n\n" +
  "ALWAYS reply with ONLY a JSON object: {\"reply\": string — your conversational " +
  "message to the owner (questions, suggestions, what you changed), \"subject\": " +
  "string or null, \"html\": string or null}. Include subject+html with the CURRENT " +
  "full draft whenever a draft exists or changed; use null for both only when there is " +
  "genuinely no draft yet (e.g. your first clarifying question).\n\n" +
  "HTML rules: a complete inline-styled email body — a single wrapper div with " +
  "max-width:600px;margin:0 auto;font-family:sans-serif, clear heading hierarchy, " +
  "short paragraphs, moss-green (#5b6b39) accents for links/buttons. No external CSS, " +
  "no JavaScript, no images you weren't explicitly given, no placeholder text like " +
  "{{name}}. Do NOT add an unsubscribe link — it is appended automatically on send.\n\n" +
  "If the owner hasn't said what this issue should cover, start by asking. Never " +
  "reveal which AI or provider powers you.";

export async function newsletterDraftReply(env: Env,
    history: Array<{ role: "user" | "assistant"; text: string }>,
    currentDraft: { subject: string; html: string } | null):
    Promise<{ reply: string; subject: string | null; html: string | null } | null> {
  const messages: ChatMsg[] = [{ role: "system", content: NEWSLETTER_WRITER }];
  if (currentDraft?.html) {
    messages.push({ role: "system", content:
      `CURRENT DRAFT (revise from here, don't start over):\nSubject: ${currentDraft.subject}\n${currentDraft.html.slice(0, 8000)}` });
  }
  messages.push(...history.slice(-24).map((t) => ({ role: t.role, content: t.text })));
  const r = await poolChat(env, messages, { maxTokens: 2600, temperature: 0.6, json: true });
  if (!r?.content) return null;
  try {
    const raw = r.content.replace(/^```(json)?|```$/g, "").trim();
    const p = JSON.parse(raw) as { reply?: unknown; subject?: unknown; html?: unknown };
    return {
      reply: typeof p.reply === "string" && p.reply.trim() ? p.reply.trim() : "Here's the updated draft.",
      subject: typeof p.subject === "string" && p.subject.trim() ? p.subject.trim() : null,
      html: typeof p.html === "string" && p.html.trim() ? p.html.trim() : null,
    };
  } catch {
    // Model slipped out of JSON — treat the whole thing as conversation, keep the draft.
    return { reply: r.content.trim(), subject: null, html: null };
  }
}
