// Newsletters, opt-in only. Recipient set = opted-in members UNION landing
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

// The ONLY domain Emblem links to. Models love to invent "emblem.com" and
// friends; every outgoing email is scrubbed so CTAs can never point at a
// domain we don't own.
function realOrigin(env: Env): string {
  return (env.APP_ORIGIN || "https://emblem.thequaniac.com").replace(/\/$/, "");
}

export function sanitizeNewsletterHtml(env: Env, html: string): string {
  const origin = realOrigin(env);
  let out = html || "";
  // Fully-qualified wrong emblem domains (any TLD, any path).
  out = out.replace(/https?:\/\/(?:www\.)?emblem\.(?:com|ai|io|app|co|net|org)(?:\/[^\s"'<)]*)?/gi, origin);
  // Scheme-less variants in hrefs or visible text.
  out = out.replace(/(?:www\.)?emblem\.(?:com|ai|io|app|co|net|org)\b/gi, origin.replace(/^https?:\/\//, ""));
  // The recurring typo of the real domain.
  out = out.replace(/thequanoac/gi, "thequaniac");
  // Generic placeholder hosts pointed home.
  out = out.replace(/https?:\/\/(?:www\.)?example\.(?:com|org)(?:\/[^\s"'<)]*)?/gi, origin);
  return out;
}

function withFooter(html: string, unsub: string): string {
  return `${html}
<div style="max-width:600px;margin:32px auto 0;padding:22px 16px 8px;border-top:1px solid #e3e5ee;
  font-family:Inter,Helvetica,Arial,sans-serif;font-size:12.5px;color:#5f6885;text-align:center;line-height:1.6">
  <p style="margin:0 0 14px">You're getting this because you subscribed to Emblem updates.</p>
  <a href="${unsub}"
     style="display:inline-block;padding:11px 26px;border-radius:999px;background:#ffffff;
       color:#0b1020;font-size:13px;font-weight:600;text-decoration:none;
       border:1px solid #c9ced9;box-shadow:0 1px 3px rgba(11,16,32,0.08)">
    Unsubscribe
  </a>
  <p style="margin:14px 0 0;color:#9aa3bf">Emblem by Quaniac · emblem.thequaniac.com</p>
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
      html: withFooter(sanitizeNewsletterHtml(env, html), await unsubUrl(env, to)),
    }),
  });
  if (!res.ok) {
    // Surface Resend's real message, "domain not verified" must reach the admin verbatim.
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

  const clean = sanitizeNewsletterHtml(env, html);
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const payload = await Promise.all(batch.map(async (to) => ({
      from: `Emblem <emblem@${env.RESEND_DOMAIN}>`,
      to: [to],
      subject: subject || "(no subject)",
      html: withFooter(clean, await unsubUrl(env, to)),
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
  "newsletter. Discuss, propose, and revise until the owner is happy. You also SUGGEST: " +
  "when audience context is provided, propose newsletter ideas that fit what the " +
  "audience is actually doing.\n\n" +
  "ALWAYS reply with ONLY a JSON object: {\"reply\": string (your conversational " +
  "message to the owner: questions, suggestions, what you changed), \"subject\": " +
  "string or null, \"html\": string or null}. Include subject+html with the CURRENT " +
  "full draft whenever a draft exists or changed; use null for both only when there is " +
  "genuinely no draft yet (for example your first clarifying question).\n\n" +
  "THE ONE DOMAIN (hard rule): every link, button, and mention points to " +
  "https://emblem.thequaniac.com and nowhere else. Never write emblem.com, www.emblem.com, " +
  "or any other domain you did not verify. If you need a link and only the homepage " +
  "exists, link the homepage.\n\n" +
  "DESIGN (the Emblem brand, follow exactly): a complete inline-styled email on a white " +
  "canvas, one wrapper div max-width:600px;margin:0 auto;font-family:Inter,Helvetica," +
  "Arial,sans-serif;color:#0b1020. Optional header band in deep navy #0b1020 with white " +
  "text and the word Emblem. Headings #0b1020, weight 600. Body text #3a4157, 15px, " +
  "line-height 1.7. Accent color for links and highlights: crimson #e5484d. Secondary " +
  "accent when needed: electric blue #3e63dd. CTA buttons are bulletproof anchors: " +
  "display:inline-block;padding:13px 30px;border-radius:999px;background:#e5484d;" +
  "color:#ffffff;font-weight:600;text-decoration:none. One primary CTA per email. " +
  "No external CSS, no JavaScript, no images you were not explicitly given, no " +
  "placeholders like {{name}}. Do NOT add an unsubscribe link or footer; it is appended " +
  "automatically on send.\n\n" +
  "VOICE: warm, plain, human. Short sentences. Write like a person emailing people they " +
  "respect, not a corporation. Never use em dashes or en dashes anywhere, use commas or " +
  "periods instead. No corporate filler, no hype words, no exclamation pileups.\n\n" +
  "If the owner has not said what this issue should cover, suggest 2-3 concrete ideas " +
  "drawn from the audience context, then ask which direction they want. Never reveal " +
  "which AI or provider powers you.";

// Aggregate, anonymous audience signals for the drafting AI. Numbers only:
// no names, no emails, no message content. Context awareness without disclosure.
export async function newsletterContext(env: Env): Promise<string> {
  const one = async (sql: string) => {
    try { return (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0; }
    catch { return 0; }
  };
  const [total, new7, onboarded, optedIn, subs, msgs7, autos, reviews30] = await Promise.all([
    one("SELECT COUNT(*) n FROM users"),
    one("SELECT COUNT(*) n FROM users WHERE created_at >= datetime('now','-7 days')"),
    one("SELECT COUNT(*) n FROM profiles WHERE onboarded = 1"),
    one("SELECT COUNT(*) n FROM profiles WHERE newsletter_opt = 1"),
    one("SELECT COUNT(*) n FROM subscribers WHERE opted = 1"),
    one("SELECT COUNT(*) n FROM conversations WHERE created_at >= datetime('now','-7 days')"),
    one("SELECT COUNT(*) n FROM automations WHERE enabled = 1"),
    one("SELECT COUNT(*) n FROM reviews WHERE created_at >= datetime('now','-30 days')"),
  ]);
  let toolkits = "";
  try {
    const rows = await env.DB.prepare(
      "SELECT toolkit, COUNT(*) n FROM connections GROUP BY toolkit ORDER BY n DESC LIMIT 5")
      .all<{ toolkit: string; n: number }>();
    toolkits = (rows.results || []).map((r) => `${r.toolkit} (${r.n})`).join(", ");
  } catch { /* fine */ }
  let lastSent = "never";
  try {
    const r = await env.DB.prepare(
      "SELECT subject, created_at FROM newsletters ORDER BY id DESC LIMIT 1")
      .first<{ subject: string; created_at: string }>();
    if (r) lastSent = `"${r.subject}" on ${r.created_at}`;
  } catch { /* fine */ }
  return [
    "AUDIENCE CONTEXT (aggregate and anonymous, use it to suggest relevant topics; never " +
    "imply you can see any individual person):",
    `- Members: ${total} total, ${new7} joined in the last 7 days, ${onboarded} onboarded.`,
    `- Newsletter reach: ${optedIn} opted-in members + ${subs} site subscribers.`,
    `- Activity: ${msgs7} chat messages in the last 7 days, ${autos} automations running.`,
    toolkits ? `- Most-connected apps: ${toolkits}.` : "",
    `- Reviews in the last 30 days: ${reviews30}.`,
    `- Last newsletter sent: ${lastSent}.`,
  ].filter(Boolean).join("\n");
}

export async function newsletterDraftReply(env: Env,
    history: Array<{ role: "user" | "assistant"; text: string }>,
    currentDraft: { subject: string; html: string } | null,
    context?: string):
    Promise<{ reply: string; subject: string | null; html: string | null } | null> {
  const messages: ChatMsg[] = [{ role: "system", content: NEWSLETTER_WRITER }];
  if (context) messages.push({ role: "system", content: context });
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
      html: typeof p.html === "string" && p.html.trim()
        ? sanitizeNewsletterHtml(env, p.html.trim()) : null,
    };
  } catch {
    // Model slipped out of JSON, treat the whole thing as conversation, keep the draft.
    return { reply: r.content.trim(), subject: null, html: null };
  }
}
