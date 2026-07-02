// Files on R2 — generated documents + user uploads, per user, streamed through
// the Worker (no public bucket). Keys are namespaced by user id so listing and
// access are naturally scoped.

import { Hono } from "hono";
import { requireUser, type AppContext } from "./auth";
import { registerTool } from "./kernel";

export const fileRoutes = new Hono<AppContext>();

fileRoutes.use("*", requireUser);

const keyFor = (userId: string, name: string) =>
  `${userId}/${name.replace(/^\/+/, "").replace(/\.\./g, "")}`;

fileRoutes.get("/files", async (c) => {
  const list = await c.env.FILES.list({ prefix: `${c.get("userId")}/` });
  return c.json({ items: list.objects.map((o) => ({
    name: o.key.slice(c.get("userId").length + 1),
    size: o.size, uploaded: o.uploaded,
  })) });
});

fileRoutes.get("/files/get", async (c) => {
  const name = c.req.query("name") || "";
  const obj = await c.env.FILES.get(keyFor(c.get("userId"), name));
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name.split("/").pop()}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

fileRoutes.post("/files/upload", async (c) => {
  const name = c.req.query("name") || "";
  if (!name) return c.json({ ok: false, error: "name required" }, 400);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 15 * 1024 * 1024) return c.json({ ok: false, error: "max 15 MB" }, 413);
  await c.env.FILES.put(keyFor(c.get("userId"), name), body, {
    httpMetadata: { contentType: c.req.header("content-type") || "application/octet-stream" },
  });
  return c.json({ ok: true, name });
});

fileRoutes.delete("/files", async (c) => {
  const name = c.req.query("name") || "";
  await c.env.FILES.delete(keyFor(c.get("userId"), name));
  return c.json({ ok: true });
});

// Agent tool: write a document to the user's files (markdown/text/html).
registerTool({
  name: "generate_document",
  tier: "safe",
  description: "Write a document and save it to the user's Files",
  summarize: (a) => `Document: ${a.title}`,
  handler: async (a, env, userId) => {
    const title = String(a.title || "document").replace(/[^\w\- ]/g, "").trim() || "document";
    const fmt = ["md", "txt", "html"].includes(String(a.format)) ? String(a.format) : "md";
    const name = `${title}.${fmt}`;
    const content = String(a.content || "");
    const body = fmt === "html"
      ? `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${content}</body>`
      : content;
    await env.FILES.put(`${userId}/${name}`, body, {
      httpMetadata: { contentType: fmt === "html" ? "text/html" : "text/plain; charset=utf-8" },
    });
    return { ok: true, name, path: name };
  },
});
