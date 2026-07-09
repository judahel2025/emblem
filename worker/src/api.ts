// /api/*, the workspace REST surface, ported 1:1 from the Python backend's
// response shapes so the Svelte frontend works unchanged. Every row is scoped
// to the authenticated user; operator surfaces 404 for everyone but the owner.

import { Hono } from "hono";
import { requireUser, type AppContext } from "./auth";
import { executeTool, resolveApproval, toolManifest, getConfig, setConfig,
         ApprovalRequired, ApprovalRejected } from "./kernel";
import { runAgent, generateTitle } from "./agent";
import { configured as composioConfigured, FEATURED_TOOLKITS, allToolkits,
         listConnections, connectionStates, initiateConnection, disconnect } from "./composio";
import { synthesize } from "./tts";
import { onboardingReply, extractAndSaveProfile, extractProfileFields, saveProfileFields } from "./onboarding";
import { reviewReply, extractReview, saveReview, type ReviewTurn } from "./reviews";
import { newsletterDraftReply, newsletterContext, recipientList, sendNewsletter, sendNewsletterEmail } from "./newsletter";
import { transcribe } from "./stt";
import { BUILTIN_SKILLS, draftSkill, normalizeSkill } from "./skills";
import { proactiveBriefing } from "./briefing";
import { pollNotifications, listNotifications } from "./notifications";
import { getSuggestions } from "./suggestions";

export const apiRoutes = new Hono<AppContext>();

apiRoutes.use("*", requireUser);

const notFound = (c: { json: (o: unknown, s?: 404) => Response }) =>
  c.json({ error: "not found" }, 404);

// ---- identity ---------------------------------------------------------------

apiRoutes.get("/me", async (c) => {
  const uid = c.get("userId");
  const p = await c.env.DB.prepare(
    "SELECT display_name, onboarded, toured FROM profiles WHERE user_id = ?").bind(uid)
    .first<{ display_name: string | null; onboarded: number | null; toured: number | null }>();
  return c.json({
    user_id: uid,
    is_admin: c.get("isOwner"),
    display_name: p?.display_name || "",
    onboarded: Boolean(p?.onboarded),
    toured: Boolean(p?.toured),
  });
});

apiRoutes.get("/me/profile", async (c) => {
  const uid = c.get("userId");
  const p = await c.env.DB.prepare(
    "SELECT display_name, role, tone, comm_style, about_me, onboarded FROM profiles WHERE user_id = ?").bind(uid)
    .first<{ display_name: string | null; role: string | null; tone: string | null;
             comm_style: string | null; about_me: string | null; onboarded: number | null }>();
  return c.json({
    display_name: p?.display_name || "", role: p?.role || "", tone: p?.tone || "",
    comm_style: p?.comm_style || "", about_me: p?.about_me || "",
    onboarded: Boolean(p?.onboarded),
  });
});

apiRoutes.put("/me/profile", async (c) => {
  const uid = c.get("userId");
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    // NOT NULL columns: the INSERT arm needs real values even when a field is
    // omitted; the UPDATE arm keeps whatever is already there.
    `INSERT INTO profiles (user_id, display_name, role, tone, comm_style, about_me, onboarded, toured)
     VALUES (?1, COALESCE(?2, ''), COALESCE(?3, ''),
             COALESCE(?4, 'warm, concise, decisive'), COALESCE(?7, ''), COALESCE(?8, ''),
             COALESCE(?5, 0), COALESCE(?6, 0))
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = COALESCE(?2, display_name),
       role = COALESCE(?3, role),
       tone = COALESCE(?4, tone),
       comm_style = COALESCE(?7, comm_style),
       about_me = COALESCE(?8, about_me),
       onboarded = COALESCE(?5, onboarded),
       toured = COALESCE(?6, toured)`)
    .bind(uid, b.display_name ?? null, b.role ?? null, b.tone ?? null,
          b.onboarded === undefined ? null : (b.onboarded ? 1 : 0),
          b.toured === undefined ? null : (b.toured ? 1 : 0),
          b.comm_style ?? null, b.about_me ?? null).run();
  return c.json({ ok: true });
});

// ---- AI onboarding (text mode, same conversation the live voice runs) --------

apiRoutes.post("/onboarding/chat", async (c) => {
  const b = await c.req.json().catch(() => ({} as { history?: Array<{ role: string; text: string }> }));
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((t: { role?: string; text?: unknown }) =>
      (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .map((t: { role: string; text: string }) =>
      ({ role: t.role as "user" | "assistant", text: t.text.slice(0, 2000) }));
  const r = await onboardingReply(c.env, history);
  if (!r) return c.json({ ok: false, error: "unavailable" }, 503);
  if (r.done) {
    const full = [...history, { role: "assistant" as const, text: r.reply }];
    const saved = await extractAndSaveProfile(c.env, c.get("userId"), full)
      .catch((e) => { console.error("onboarding extract failed:", e); return null; });
    return c.json({ ok: true, reply: r.reply, done: true, saved: Boolean(saved) });
  }
  return c.json({ ok: true, reply: r.reply, done: false });
});

// Switching AI → form mid-conversation: pull whatever the chat already learned
// so the form pre-fills and the member never repeats themselves. No save.
apiRoutes.post("/onboarding/extract", async (c) => {
  const b = await c.req.json().catch(() => ({} as { history?: Array<{ role: string; text: string }> }));
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((t: { role?: string; text?: unknown }) =>
      (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .map((t: { role: string; text: string }) =>
      ({ role: t.role as "user" | "assistant", text: t.text.slice(0, 2000) }));
  const fields = await extractProfileFields(c.env, history).catch(() => ({} as Record<string, unknown>));
  return c.json({ ok: true, fields });
});

// Classic-form onboarding completion: saves profile + memories directly from
// the typed fields (extractor-shaped), no LLM in the loop.
apiRoutes.post("/onboarding/form", async (c) => {
  const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const fields = (b && typeof b.fields === "object" && b.fields) ? b.fields as Record<string, unknown> : {};
  const saved = await saveProfileFields(c.env, c.get("userId"), fields)
    .catch((e) => { console.error("onboarding form save failed:", e); return null; });
  return c.json({ ok: Boolean(saved), saved: Boolean(saved) });
});

// ---- proactive grounding (one real-signal line, surfaced on app open) ----------

apiRoutes.get("/briefing", async (c) => {
  const r = await proactiveBriefing(c.env, c.get("userId")).catch(() => ({ line: "" }));
  return c.json(r);
});

// ---- notifications ------------------------------------------------------------

apiRoutes.get("/notifications", async (c) =>
  c.json(await listNotifications(c.env, c.get("userId")).catch(() => ({ items: [], unread: 0 }))));

// Poll connectors for new activity → returns any freshly-created notifications so
// the client can pop Chrome alerts. Called on app open + on an interval while open.
apiRoutes.post("/notifications/poll", async (c) => {
  const fresh = await pollNotifications(c.env, c.get("userId")).catch(() => []);
  const { unread } = await listNotifications(c.env, c.get("userId")).catch(() => ({ unread: 0 }));
  return c.json({ fresh, unread });
});

apiRoutes.post("/notifications/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

apiRoutes.post("/notifications/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0")
    .bind(c.get("userId")).run();
  return c.json({ ok: true });
});

apiRoutes.delete("/notifications/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- personalized workflow suggestions -----------------------------------------

apiRoutes.get("/suggestions", async (c) => {
  const force = c.req.query("refresh") === "1";
  const items = await getSuggestions(c.env, c.get("userId"), force)
    .catch((e) => { console.error("suggestions failed:", e); return []; });
  return c.json({ items });
});

// ---- one-shot narration (tour + spoken replies) -------------------------------

apiRoutes.post("/voice/tts", async (c) => {
  const b = await c.req.json().catch(() => ({} as { text?: string; voice?: string }));
  return synthesize(c.env, String(b.text || ""), b.voice ? String(b.voice) : undefined);
});

// ---- speech-to-text (the turn-based voice pipeline's ear) ----------------------

apiRoutes.post("/voice/transcribe", async (c) => {
  const form = await c.req.formData().catch(() => null);
  // Workers' FormData typing says string-only; at runtime file parts arrive as File.
  const f = form?.get("audio") as unknown as File | string | null | undefined;
  if (!f || typeof f === "string" || !f.size) return c.json({ ok: false, error: "audio required" }, 400);
  if (f.size > 20 * 1024 * 1024) return c.json({ ok: false, error: "clip too long" }, 413);
  return c.json(await transcribe(c.env, f));
});

// ---- user reviews (AI-guided interview or typed) -------------------------------

apiRoutes.post("/reviews/chat", async (c) => {
  const b = await c.req.json().catch(() => ({} as { history?: Array<{ role: string; text: string }> }));
  const history: ReviewTurn[] = (Array.isArray(b.history) ? b.history : [])
    .filter((t: { role?: string; text?: unknown }) =>
      (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .map((t: { role: string; text: string }) =>
      ({ role: t.role as "user" | "assistant", text: t.text.slice(0, 2000) }));
  const r = await reviewReply(c.env, history);
  if (!r) return c.json({ ok: false, error: "unavailable" }, 503);
  if (r.done) {
    const full = [...history, { role: "assistant" as const, text: r.reply }];
    const { summary, sentiment } = await extractReview(c.env, full);
    const id = await saveReview(c.env, c.get("userId"), "ai", summary, full, sentiment)
      .catch((e) => { console.error("review save failed:", e); return 0; });
    return c.json({ ok: true, reply: r.reply, done: true, saved: id > 0 });
  }
  return c.json({ ok: true, reply: r.reply, done: false });
});

apiRoutes.post("/reviews", async (c) => {
  const b = await c.req.json().catch(() => ({} as { text?: string }));
  const text = String(b.text || "").trim();
  if (!text) return c.json({ ok: false, error: "empty review" }, 400);
  const id = await saveReview(c.env, c.get("userId"), "typed", text.slice(0, 4000), null)
    .catch((e) => { console.error("review save failed:", e); return 0; });
  return c.json({ ok: id > 0, id });
});

// ---- newsletter opt state (all users; weekly popup logic) ----------------------

apiRoutes.get("/newsletter/state", async (c) => {
  const p = await c.env.DB.prepare(
    "SELECT newsletter_opt, newsletter_prompted_at FROM profiles WHERE user_id = ?1")
    .bind(c.get("userId"))
    .first<{ newsletter_opt: number | null; newsletter_prompted_at: string | null }>();
  const opt = p?.newsletter_opt ?? null;
  let prompt = false;
  if (opt === null) {
    const last = p?.newsletter_prompted_at;
    if (!last) prompt = true;
    else {
      const row = await c.env.DB.prepare(
        "SELECT (?1 < datetime('now', '-7 days')) AS stale").bind(last).first<{ stale: number }>();
      prompt = Boolean(row?.stale);
    }
  }
  return c.json({ opt, prompt });
});

apiRoutes.post("/newsletter/opt", async (c) => {
  const b = await c.req.json().catch(() => ({} as { choice?: string }));
  const choice = String(b.choice || "");
  if (!["in", "out", "later"].includes(choice)) return c.json({ ok: false, error: "bad choice" }, 400);
  const opt = choice === "in" ? 1 : choice === "out" ? 0 : null;
  if (choice === "later") {
    await c.env.DB.prepare(
      "UPDATE profiles SET newsletter_prompted_at = datetime('now') WHERE user_id = ?1")
      .bind(c.get("userId")).run();
  } else {
    await c.env.DB.prepare(
      "UPDATE profiles SET newsletter_opt = ?2, newsletter_prompted_at = datetime('now') WHERE user_id = ?1")
      .bind(c.get("userId"), opt).run();
  }
  return c.json({ ok: true });
});

// ---- admin console (owner only, 404 for everyone else, same as /audit) --------

apiRoutes.get("/admin/users", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.verified, u.created_at,
            p.display_name, p.role, p.onboarded, p.newsletter_opt
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     ORDER BY u.created_at DESC LIMIT 500`).all();
  const items = rows.results || [];
  return c.json({ items, total: items.length });
});

apiRoutes.get("/admin/reviews", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.kind, r.summary, r.transcript, r.sentiment, r.status, r.created_at,
            u.email, p.display_name
     FROM reviews r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN profiles p ON p.user_id = r.user_id
     ORDER BY r.id DESC LIMIT 200`).all();
  const items = rows.results || [];
  const nc = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reviews WHERE status = 'new'").first<{ n: number }>();
  return c.json({ items, new_count: nc?.n ?? 0 });
});

apiRoutes.post("/admin/reviews/:id/read", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  await c.env.DB.prepare("UPDATE reviews SET status = 'read' WHERE id = ?1")
    .bind(parseInt(c.req.param("id")) || 0).run();
  return c.json({ ok: true });
});

apiRoutes.post("/admin/newsletter/chat", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const b = await c.req.json().catch(() => ({} as {
    history?: Array<{ role: string; text: string }>;
    draft?: { subject?: string; html?: string } | null }));
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((t: { role?: string; text?: unknown }) =>
      (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .map((t: { role: string; text: string }) =>
      ({ role: t.role as "user" | "assistant", text: t.text.slice(0, 4000) }));
  const draft = (b.draft && typeof b.draft.html === "string")
    ? { subject: String(b.draft.subject || ""), html: b.draft.html } : null;
  const context = await newsletterContext(c.env).catch(() => "");
  const r = await newsletterDraftReply(c.env, history, draft, context || undefined);
  if (!r) return c.json({ ok: false, error: "unavailable" }, 503);
  return c.json({ ok: true, ...r });
});

apiRoutes.get("/admin/newsletter/recipients", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const { members, subscribers } = await recipientList(c.env);
  return c.json({ count: members.length + subscribers.length,
    members: members.length, subscribers: subscribers.length });
});

apiRoutes.post("/admin/newsletter/test", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const b = await c.req.json().catch(() => ({} as { subject?: string; html?: string }));
  const owner = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?1")
    .bind(c.env.EMBLEM_OWNER_USER_ID || "").first<{ email: string }>();
  if (!owner?.email) return c.json({ ok: false, error: "owner email not found" });
  const r = await sendNewsletterEmail(c.env, owner.email,
    String(b.subject || ""), String(b.html || ""));
  return c.json({ ...r, to: owner.email });
});

apiRoutes.post("/admin/newsletter/send", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const b = await c.req.json().catch(() => ({} as { subject?: string; html?: string }));
  const subject = String(b.subject || "").trim();
  const html = String(b.html || "").trim();
  if (!subject || !html) return c.json({ ok: false, error: "subject and html required" }, 400);
  const r = await sendNewsletter(c.env, subject, html);
  await c.env.DB.prepare(
    "INSERT INTO newsletters (subject, html, sent_count, fail_count) VALUES (?1, ?2, ?3, ?4)")
    .bind(subject, html, r.sent, r.failed).run().catch(() => {});
  return c.json({ ok: r.failed === 0 && r.sent > 0, ...r });
});

apiRoutes.get("/admin/newsletter/history", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const rows = await c.env.DB.prepare(
    "SELECT id, subject, sent_count, fail_count, created_at FROM newsletters ORDER BY id DESC LIMIT 50").all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.get("/admin/newsletter/domain", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  if (!c.env.RESEND_KEY || !c.env.RESEND_DOMAIN) {
    return c.json({ configured: false, domain: c.env.RESEND_DOMAIN || null, status: "missing" });
  }
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${c.env.RESEND_KEY}` } });
    if (!res.ok) {
      return c.json({ configured: true, domain: c.env.RESEND_DOMAIN, status: "unknown",
        error: `resend ${res.status}` });
    }
    const d = await res.json<{ data?: Array<{ id: string; name: string; status: string }> }>();
    const match = (d.data || []).find((x) => x.name === c.env.RESEND_DOMAIN);
    let records: unknown = null;
    if (match) {
      const det = await fetch(`https://api.resend.com/domains/${match.id}`, {
        headers: { Authorization: `Bearer ${c.env.RESEND_KEY}` } }).catch(() => null);
      if (det?.ok) records = (await det.json<{ records?: unknown }>()).records ?? null;
    }
    return c.json({ configured: true, domain: c.env.RESEND_DOMAIN,
      status: match ? match.status : "missing", id: match?.id ?? null, records });
  } catch {
    return c.json({ configured: true, domain: c.env.RESEND_DOMAIN, status: "unknown" });
  }
});

// Registers RESEND_DOMAIN with Resend (or verifies an existing registration) and
// returns the DNS records Judah must add in NAMECHEAP (the domain's DNS host).
apiRoutes.post("/admin/newsletter/domain/register", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  if (!c.env.RESEND_KEY || !c.env.RESEND_DOMAIN) {
    return c.json({ ok: false, error: "RESEND_KEY / RESEND_DOMAIN not configured" });
  }
  const auth = { Authorization: `Bearer ${c.env.RESEND_KEY}`, "Content-Type": "application/json" };
  try {
    // Already registered? Trigger a verify pass and return its records.
    const list = await fetch("https://api.resend.com/domains", { headers: auth });
    if (list.ok) {
      const d = await list.json<{ data?: Array<{ id: string; name: string; status: string }> }>();
      const match = (d.data || []).find((x) => x.name === c.env.RESEND_DOMAIN);
      if (match) {
        await fetch(`https://api.resend.com/domains/${match.id}/verify`, {
          method: "POST", headers: auth }).catch(() => {});
        const det = await fetch(`https://api.resend.com/domains/${match.id}`, { headers: auth });
        const dd = det.ok ? await det.json<Record<string, unknown>>() : {};
        return c.json({ ok: true, existing: true, id: match.id,
          status: (dd as { status?: string }).status ?? match.status,
          records: (dd as { records?: unknown }).records ?? null });
      }
    }
    const res = await fetch("https://api.resend.com/domains", {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: c.env.RESEND_DOMAIN }),
    });
    const body = await res.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      return c.json({ ok: false,
        error: (body as { message?: string }).message || `resend ${res.status}` });
    }
    return c.json({ ok: true, existing: false, id: (body as { id?: string }).id ?? null,
      status: (body as { status?: string }).status ?? "pending",
      records: (body as { records?: unknown }).records ?? null });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "registration failed" });
  }
});

// ---- conversations ----------------------------------------------------------

apiRoutes.get("/conversations", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "100") || 100, 300);
  const threadQ = c.req.query("thread_id");
  let rows;
  if (threadQ === "legacy") {
    // Pre-threads history, shown as one "Earlier" bucket.
    rows = await c.env.DB.prepare(
      "SELECT id, role, text, created_at FROM conversations WHERE user_id = ? AND thread_id IS NULL ORDER BY id DESC LIMIT ?")
      .bind(c.get("userId"), limit).all();
  } else if (threadQ) {
    rows = await c.env.DB.prepare(
      "SELECT id, role, text, created_at FROM conversations WHERE user_id = ? AND thread_id = ? ORDER BY id DESC LIMIT ?")
      .bind(c.get("userId"), parseInt(threadQ) || 0, limit).all();
  } else {
    rows = await c.env.DB.prepare(
      "SELECT id, role, text, created_at FROM conversations WHERE user_id = ? ORDER BY id DESC LIMIT ?")
      .bind(c.get("userId"), limit).all();
  }
  return c.json({ items: (rows.results || []).reverse() });
});

apiRoutes.post("/conversations", async (c) => {
  const { role = "", text = "", thread_id = null } = await c.req.json().catch(() => ({}));
  if ((role === "user" || role === "assistant") && String(text).trim()) {
    const tid = Number(thread_id) || null;
    await c.env.DB.prepare(
      "INSERT INTO conversations (role, text, thread_id, user_id) VALUES (?, ?, ?, ?)")
      .bind(role, String(text).slice(0, 8000), tid, c.get("userId")).run();
    if (tid) {
      // Bump recency; auto-title from the first user message.
      await c.env.DB.prepare(
        `UPDATE threads SET updated_at = datetime('now'),
           title = CASE WHEN title = 'New chat' AND ?2 = 'user' THEN ?3 ELSE title END
         WHERE id = ?1 AND user_id = ?4`)
        .bind(tid, role, String(text).slice(0, 60), c.get("userId")).run();
    }
  }
  return c.json({ ok: true });
});

apiRoutes.delete("/conversations", async (c) => {
  await c.env.DB.prepare("DELETE FROM conversations WHERE user_id = ?")
    .bind(c.get("userId")).run();
  await c.env.DB.prepare("DELETE FROM threads WHERE user_id = ?")
    .bind(c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- threads (ChatGPT-style conversation list) --------------------------------

apiRoutes.get("/threads", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, created_at, updated_at FROM threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100")
    .bind(c.get("userId")).all();
  const legacy = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM conversations WHERE user_id = ? AND thread_id IS NULL")
    .bind(c.get("userId")).first<{ n: number }>();
  return c.json({ items: rows.results || [], legacy_count: legacy?.n || 0 });
});

apiRoutes.post("/threads", async (c) => {
  const { title = "New chat" } = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare(
    "INSERT INTO threads (title, user_id) VALUES (?, ?)")
    .bind(String(title).slice(0, 60) || "New chat", c.get("userId")).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.post("/threads/:id/autotitle", async (c) => {
  const { prompt = "" } = await c.req.json().catch(() => ({}));
  if (!String(prompt).trim()) return c.json({ ok: false, error: "prompt required" });
  const title = await generateTitle(c.env, String(prompt));
  await c.env.DB.prepare(
    "UPDATE threads SET title = ? WHERE id = ? AND user_id = ?")
    .bind(title, c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true, title });
});

apiRoutes.put("/threads/:id", async (c) => {
  const { title = "" } = await c.req.json().catch(() => ({}));
  if (!String(title).trim()) return c.json({ ok: false, error: "title required" });
  await c.env.DB.prepare(
    "UPDATE threads SET title = ? WHERE id = ? AND user_id = ?")
    .bind(String(title).slice(0, 60), c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

apiRoutes.delete("/threads/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM conversations WHERE thread_id = ? AND user_id = ?")
    .bind(id, c.get("userId")).run();
  await c.env.DB.prepare(
    "DELETE FROM threads WHERE id = ? AND user_id = ?")
    .bind(id, c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- notes -------------------------------------------------------------------

apiRoutes.get("/notes", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, body, color, pinned, created_at, updated_at FROM notes " +
    "WHERE user_id = ? ORDER BY pinned DESC, id DESC LIMIT 300")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.post("/notes", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare(
    "INSERT INTO notes (title, body, color, user_id) VALUES (?, ?, ?, ?)")
    .bind(b.title || "", b.body || "", b.color || "default", c.get("userId")).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.put("/notes/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const vals: unknown[] = [];
  for (const k of ["title", "body", "color", "pinned"] as const) {
    if (b[k] !== undefined && b[k] !== null) { sets.push(`${k} = ?`); vals.push(b[k]); }
  }
  if (!sets.length) return c.json({ ok: false });
  await c.env.DB.prepare(
    `UPDATE notes SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(...vals, c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

apiRoutes.delete("/notes/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- memory (long-term) ------------------------------------------------------

apiRoutes.get("/memory", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, content, source, pinned, created_at FROM memory " +
    "WHERE user_id = ? AND deleted = 0 ORDER BY pinned DESC, id DESC LIMIT 200")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.put("/memory/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.content === "string") {
    const content = b.content.trim();
    if (!content) return c.json({ ok: false, error: "Content is required." }, 400);
    sets.push("content = ?"); binds.push(content);
  }
  if (b.pinned !== undefined) { sets.push("pinned = ?"); binds.push(b.pinned ? 1 : 0); }
  if (!sets.length) return c.json({ ok: false, error: "Nothing to update." }, 400);
  binds.push(c.req.param("id"), c.get("userId"));
  await c.env.DB.prepare(
    `UPDATE memory SET ${sets.join(", ")} WHERE id = ? AND user_id = ? AND deleted = 0`)
    .bind(...binds).run();
  return c.json({ ok: true });
});

apiRoutes.post("/memory", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const content = String(b.content || "").trim();
  if (!content) return c.json({ ok: false, error: "Content is required." }, 400);
  const r = await c.env.DB.prepare(
    "INSERT INTO memory (kind, content, source, user_id) VALUES (?, ?, 'user', ?)")
    .bind(b.kind || "fact", content, c.get("userId")).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.delete("/memory/:id", async (c) => {
  await c.env.DB.prepare("UPDATE memory SET deleted = 1 WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- skills -------------------------------------------------------------------

apiRoutes.get("/skills", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, description, instructions, source, enabled, updated_at FROM skills " +
    "WHERE user_id = ? ORDER BY id DESC LIMIT 200").bind(c.get("userId")).all().catch(() => ({ results: [] }));
  const builtin = BUILTIN_SKILLS.map((s) => ({ name: s.name, description: s.description, builtin: true }));
  return c.json({ items: rows.results || [], builtin });
});

apiRoutes.post("/skills", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = String(b.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  const description = String(b.description || "").trim().slice(0, 1024);
  const instructions = String(b.instructions || "").trim().slice(0, 8000);
  if (!name || !description) return c.json({ ok: false, error: "Name and description are required." }, 400);
  const src = ["user_chat", "user_paste", "imported"].includes(b.source) ? b.source : "user_chat";
  const r = await c.env.DB.prepare(
    "INSERT INTO skills (user_id, name, description, instructions, source) VALUES (?, ?, ?, ?, ?)")
    .bind(c.get("userId"), name, description, instructions, src).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.put("/skills/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = [], binds: unknown[] = [];
  if (typeof b.name === "string") { sets.push("name = ?"); binds.push(b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64)); }
  if (typeof b.description === "string") { sets.push("description = ?"); binds.push(b.description.slice(0, 1024)); }
  if (typeof b.instructions === "string") { sets.push("instructions = ?"); binds.push(b.instructions.slice(0, 8000)); }
  if (b.enabled !== undefined) { sets.push("enabled = ?"); binds.push(b.enabled ? 1 : 0); }
  if (!sets.length) return c.json({ ok: false, error: "Nothing to update." }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(c.req.param("id"), c.get("userId"));
  await c.env.DB.prepare(`UPDATE skills SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...binds).run();
  return c.json({ ok: true });
});

apiRoutes.delete("/skills/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM skills WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

apiRoutes.post("/skills/draft", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const desc = String(b.description || "").trim();
  if (!desc) return c.json({ ok: false, error: "Describe what you want the skill to do." }, 400);
  const draft = b.paste ? await normalizeSkill(c.env, desc) : await draftSkill(c.env, desc);
  return draft ? c.json({ ok: true, skill: draft })
               : c.json({ ok: false, error: "Couldn't draft that, try describing it a bit more." }, 502);
});

/** Keyword recall + always-on pinned facts. Pinned memories are never dropped
 *  (the user locked them); the rest are keyword-matched to the current message. */
export async function recallMemory(db: D1Database, userId: string, query: string, k = 6) {
  const rows = await db.prepare(
    "SELECT id, kind, content, pinned FROM memory WHERE user_id = ? AND deleted = 0 " +
    "ORDER BY id DESC LIMIT 400")
    .bind(userId).all<{ id: number; kind: string; content: string; pinned: number }>();
  const all = rows.results || [];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const pinned = all.filter((r) => r.pinned);
  const matched = all.filter((r) => !r.pinned && words.some((w) => r.content.toLowerCase().includes(w)));
  // Pinned first, then keyword hits, de-duped, capped.
  const out: Array<{ id: number; kind: string; content: string }> = [];
  const seen = new Set<number>();
  for (const r of [...pinned, ...matched]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, kind: r.kind, content: r.content });
    if (out.length >= k) break;
  }
  return out;
}

// ---- pages -------------------------------------------------------------------

apiRoutes.get("/pages", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, icon, archived, created_at, updated_at FROM pages " +
    "WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 200")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.get("/pages/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, title, blocks, icon, created_at, updated_at FROM pages WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .first<{ blocks: string } & Record<string, unknown>>();
  if (!row) return notFound(c);
  return c.json({ ...row, blocks: JSON.parse(row.blocks || "[]") });
});

apiRoutes.post("/pages", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare(
    "INSERT INTO pages (title, blocks, icon, user_id) VALUES (?, ?, ?, ?)")
    .bind(b.title || "Untitled", JSON.stringify(b.blocks || []), b.icon || "", c.get("userId")).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.put("/pages/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const vals: unknown[] = [];
  if (b.title !== undefined) { sets.push("title = ?"); vals.push(b.title); }
  if (b.blocks !== undefined) { sets.push("blocks = ?"); vals.push(JSON.stringify(b.blocks)); }
  if (b.icon !== undefined) { sets.push("icon = ?"); vals.push(b.icon); }
  if (b.archived !== undefined) { sets.push("archived = ?"); vals.push(b.archived ? 1 : 0); }
  if (!sets.length) return c.json({ ok: false });
  await c.env.DB.prepare(
    `UPDATE pages SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(...vals, c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

apiRoutes.delete("/pages/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM pages WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- calendar ----------------------------------------------------------------

apiRoutes.get("/calendar", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, starts_at, ends_at, all_day, source, remind_secs FROM calendar_events " +
    "WHERE user_id = ? ORDER BY starts_at ASC LIMIT 500")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.post("/calendar", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.title || !b.starts_at) return c.json({ ok: false, error: "title and starts_at required" }, 400);
  const r = await c.env.DB.prepare(
    "INSERT INTO calendar_events (title, starts_at, ends_at, all_day, remind_secs, user_id) " +
    "VALUES (?, ?, ?, ?, ?, ?)")
    .bind(b.title, b.starts_at, b.ends_at || null, b.all_day ? 1 : 0,
          b.remind_secs ?? null, c.get("userId")).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.delete("/calendar/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM calendar_events WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- automations ---------------------------------------------------------------

apiRoutes.get("/automations", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, instruction, every_secs, next_run, enabled, quiet_aware, last_run, last_result " +
    "FROM automations WHERE user_id = ? ORDER BY id DESC LIMIT 100")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.post("/automations", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.instruction) return c.json({ ok: false, error: "instruction required" }, 400);
  const every = Math.max(parseInt(b.every_secs) || 86400, 120);
  const r = await c.env.DB.prepare(
    "INSERT INTO automations (title, instruction, every_secs, next_run, enabled, quiet_aware, user_id) " +
    "VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'), 1, ?, ?)")
    .bind(b.title || String(b.instruction).slice(0, 60), b.instruction, every, every,
          b.quiet_aware === false ? 0 : 1, c.get("userId")).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

apiRoutes.put("/automations/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (b.enabled !== undefined) {
    await c.env.DB.prepare("UPDATE automations SET enabled = ? WHERE id = ? AND user_id = ?")
      .bind(b.enabled ? 1 : 0, c.req.param("id"), c.get("userId")).run();
  }
  return c.json({ ok: true });
});

apiRoutes.delete("/automations/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM automations WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- alerts --------------------------------------------------------------------

apiRoutes.get("/alerts", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, title, body, created_at FROM alerts " +
    "WHERE user_id = ? AND seen = 0 ORDER BY id ASC LIMIT 50")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.post("/alerts/:id/seen", async (c) => {
  await c.env.DB.prepare("UPDATE alerts SET seen = 1 WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});

// ---- kernel: approvals (per-user), audit/config/tools (owner) -----------------

apiRoutes.get("/approvals", async (c) => {
  const uid = c.get("userId");
  const pending = await c.env.DB.prepare(
    "SELECT id, tool, summary, risk, args_json, created_at FROM kernel_approvals " +
    "WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 20").bind(uid).all();
  const recent = await c.env.DB.prepare(
    "SELECT id, tool, summary, status, decided_at FROM kernel_approvals " +
    "WHERE user_id = ? AND status != 'pending' ORDER BY id DESC LIMIT 20").bind(uid).all();
  return c.json({ pending: pending.results || [], recent: recent.results || [] });
});

apiRoutes.post("/approvals/:id/decide", async (c) => {
  const { approved = false } = await c.req.json().catch(() => ({}));
  const res = await resolveApproval(c.env, c.get("userId"),
    parseInt(c.req.param("id")), Boolean(approved));
  return c.json({ ok: res.ok, approval_id: parseInt(c.req.param("id")),
    status: approved ? "approved" : "rejected", result: res.result ?? null,
    error: res.error });
});

apiRoutes.post("/tools/execute", async (c) => {
  const { name = "", args = {}, approval_id = null } = await c.req.json().catch(() => ({}));
  try {
    const result = await executeTool(c.env, c.get("userId"), String(name),
      args, "user", approval_id || undefined);
    return c.json({ ok: true, result });
  } catch (e) {
    if (e instanceof ApprovalRequired) {
      return c.json({ ok: false, approval_required: true, approval_id: e.approvalId, summary: e.summary });
    }
    if (e instanceof ApprovalRejected) {
      return c.json({ ok: false, rejected: true, approval_id: e.approvalId });
    }
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.get("/audit", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const limit = Math.min(parseInt(c.req.query("limit") || "100") || 100, 500);
  const rows = await c.env.DB.prepare(
    "SELECT id, actor, tool, tier, args_json, status, result, user_id, created_at " +
    "FROM kernel_audit ORDER BY id DESC LIMIT ?").bind(limit).all();
  return c.json({ items: rows.results || [] });
});

apiRoutes.get("/config", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  return c.json({
    kill_switch: (await getConfig(c.env, "kill_switch", "0")) === "1",
    approval_mode: await getConfig(c.env, "approval_mode", "ask"),
  });
});

apiRoutes.post("/config/kill-switch", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const { on = false } = await c.req.json().catch(() => ({}));
  await setConfig(c.env, "kill_switch", on ? "1" : "0");
  return c.json({ ok: true, kill_switch: Boolean(on) });
});

apiRoutes.post("/config/approval-mode", async (c) => {
  if (!c.get("isOwner")) return notFound(c);
  const { mode = "ask" } = await c.req.json().catch(() => ({}));
  await setConfig(c.env, "approval_mode", mode === "auto" ? "auto" : "ask");
  return c.json({ ok: true, approval_mode: mode === "auto" ? "auto" : "ask" });
});

apiRoutes.get("/tools", (c) => {
  if (!c.get("isOwner")) return notFound(c);
  return c.json({ tools: toolManifest() });
});


// ---- the agent + connections ---------------------------------------------------

apiRoutes.post("/agent", async (c) => {
  const { command = "", context = {} } = await c.req.json().catch(() => ({}));
  if (!String(command).trim()) return c.json({ intent: "agent", reply: "", actions: [] });
  const result = await runAgent(c.env, c.get("userId"), c.get("isOwner"),
    String(command), (context as { history?: [] }).history || []);
  return c.json(result);
});

apiRoutes.get("/connections", async (c) => {
  const uid = c.get("userId");
  const [states, all, resourcesRows] = await Promise.all([
    connectionStates(c.env, uid),
    allToolkits(c.env),
    c.env.DB.prepare("SELECT key, value FROM kernel_config WHERE key LIKE ?").bind(`${uid}_resource_%`).all<{ key: string; value: string }>()
  ]);
  const resources: Record<string, any> = {};
  for (const r of resourcesRows.results || []) {
    const appName = r.key.replace(`${uid}_resource_`, "");
    try { resources[appName] = JSON.parse(r.value); } catch { resources[appName] = r.value; }
  }
  return c.json({ configured: composioConfigured(c.env),
    featured: FEATURED_TOOLKITS, connected: states.active, broken: states.broken, all, resources });
});

apiRoutes.get("/connections/link", async (c) => {
  const toolkit = c.req.query("toolkit") || "";
  if (!toolkit) return c.json({ ok: false, error: "toolkit required" });
  try {
    const url = await initiateConnection(c.env, toolkit, c.get("userId"));
    return c.json({ ok: true, url });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.post("/connections/disconnect", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const toolkit = String(b.toolkit || "").toLowerCase().trim();
  if (!toolkit) return c.json({ ok: false, error: "toolkit required" });
  const removed = await disconnect(c.env, c.get("userId"), toolkit);
  return c.json({ ok: removed > 0, removed });
});

apiRoutes.all("*", (c) => notFound(c));
