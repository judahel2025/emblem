// /api/* — the workspace REST surface, ported 1:1 from the Python backend's
// response shapes so the Svelte frontend works unchanged. Every row is scoped
// to the authenticated user; operator surfaces 404 for everyone but the owner.

import { Hono } from "hono";
import { requireUser, type AppContext } from "./auth";

export const apiRoutes = new Hono<AppContext>();

apiRoutes.use("*", requireUser);

const notFound = (c: { json: (o: unknown, s?: 404) => Response }) =>
  c.json({ error: "not found" }, 404);

// ---- identity ---------------------------------------------------------------

apiRoutes.get("/me", async (c) => {
  const uid = c.get("userId");
  const p = await c.env.DB.prepare(
    "SELECT display_name, onboarded FROM profiles WHERE user_id = ?").bind(uid)
    .first<{ display_name: string | null; onboarded: number | null }>();
  return c.json({
    user_id: uid,
    is_admin: c.get("isOwner"),
    display_name: p?.display_name || "",
    onboarded: Boolean(p?.onboarded),
  });
});

apiRoutes.put("/me/profile", async (c) => {
  const uid = c.get("userId");
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    `INSERT INTO profiles (user_id, display_name, role, tone, onboarded)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = COALESCE(?2, display_name),
       role = COALESCE(?3, role),
       tone = COALESCE(?4, tone),
       onboarded = COALESCE(?5, onboarded)`)
    .bind(uid, b.display_name ?? null, b.role ?? null, b.tone ?? null,
          b.onboarded === undefined ? null : (b.onboarded ? 1 : 0)).run();
  return c.json({ ok: true });
});

// ---- conversations ----------------------------------------------------------

apiRoutes.get("/conversations", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "100") || 100, 300);
  const rows = await c.env.DB.prepare(
    "SELECT id, role, text, created_at FROM conversations WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .bind(c.get("userId"), limit).all();
  return c.json({ items: (rows.results || []).reverse() });
});

apiRoutes.post("/conversations", async (c) => {
  const { role = "", text = "" } = await c.req.json().catch(() => ({}));
  if ((role === "user" || role === "assistant") && String(text).trim()) {
    await c.env.DB.prepare(
      "INSERT INTO conversations (role, text, user_id) VALUES (?, ?, ?)")
      .bind(role, String(text).slice(0, 8000), c.get("userId")).run();
  }
  return c.json({ ok: true });
});

apiRoutes.delete("/conversations", async (c) => {
  await c.env.DB.prepare("DELETE FROM conversations WHERE user_id = ?")
    .bind(c.get("userId")).run();
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
    "SELECT id, kind, content, source, created_at FROM memory " +
    "WHERE user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 200")
    .bind(c.get("userId")).all();
  return c.json({ items: rows.results || [] });
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

/** Keyword recall — same fallback strategy the Python store used without embeddings. */
export async function recallMemory(db: D1Database, userId: string, query: string, k = 6) {
  const rows = await db.prepare(
    "SELECT id, kind, content FROM memory WHERE user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 400")
    .bind(userId).all<{ id: number; kind: string; content: string }>();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const hits = (rows.results || []).filter((r) =>
    words.some((w) => r.content.toLowerCase().includes(w)));
  return hits.slice(0, k);
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

// ---- operator surfaces (owner only; invisible to everyone else) ---------------
// Filled in properly in C4 (kernel) — the 404 gate is the contract that matters.

for (const path of ["/audit", "/config", "/secrets", "/tools", "/brain"]) {
  apiRoutes.get(path, (c) => {
    if (!c.get("isOwner")) return notFound(c);
    return c.json({ items: [], note: "kernel lands in C4" });
  });
}

apiRoutes.all("*", (c) => notFound(c));
