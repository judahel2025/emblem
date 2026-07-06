// Emblem, the whole backend as one Cloudflare Worker.
// Serves the Svelte app (static assets, same origin), the /api REST surface,
// the /auth endpoints, the /api/voice/live WebSocket relay, and the cron heartbeat.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { authRoutes } from "./auth";
import { apiRoutes } from "./api";
import { heartbeat } from "./cron";
import "./tools";  // registers native tools with the kernel
import { fileRoutes } from "./r2";
import { verifyUnsubSig } from "./newsletter";
import { b64urlDecode } from "./lib/crypto";
export { VoiceRelay } from "./voice_do";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Tiny standalone page for the unsubscribe flow, no app assets needed.
const unsubPage = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}, Emblem</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#ebe9dd;
  font-family:sans-serif;color:#0a0a0a">
<div style="max-width:420px;padding:36px;text-align:center">
  <div style="font-size:40px;margin-bottom:12px">🌿</div>
  <h1 style="font-size:22px;margin:0 0 10px">${title}</h1>
  <p style="font-size:15px;line-height:1.6;color:#4d4a40;margin:0">${body}</p>
</div></body></html>`;

const app = new Hono<{ Bindings: Env }>();

// Allow the frontend origin, Vercel-hosted app (emblem.thequaniac.com + preview
// deploys) and localhost dev. Tokens ride in the Authorization header, not cookies,
// so no credentials mode is needed. Same-origin (Vercel-proxied) requests skip this.
app.use("/api/*", cors({
  origin: (o) => (/^https:\/\/(emblem\.thequaniac\.com|[a-z0-9-]+\.vercel\.app)$/.test(o) ||
                  /^http:\/\/localhost(:\d+)?$/.test(o)) ? o : "",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
app.use("/auth/*", cors({
  origin: (o) => (/^https:\/\/(emblem\.thequaniac\.com|[a-z0-9-]+\.vercel\.app)$/.test(o) ||
                  /^http:\/\/localhost(:\d+)?$/.test(o)) ? o : "",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Never reveal what powers Emblem, health is name + readiness only.
app.get("/api/health", (c) => c.json({ name: "Emblem", status: "online", ready: true }));

// Connector logos, proxied same-origin so the browser never sees the upstream
// provider (provider secrecy, no third-party host in the network tab). Public
// on purpose: <img> can't send an auth header, and a brand logo isn't sensitive.
// The SVG is returned for <img> only, where any embedded script can't execute.
app.get("/api/logo/:slug", async (c) => {
  const slug = (c.req.param("slug") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!slug) return c.text("not found", 404);
  try {
    const res = await fetch(`https://logos.composio.dev/api/${slug}`, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return c.text("not found", 404);
    return new Response(await res.arrayBuffer(), {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/svg+xml",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return c.text("not found", 404);
  }
});

// PUBLIC newsletter endpoints, registered before apiRoutes so requireUser never
// sees them. Must live under /api/* (run_worker_first + the Vercel rewrites only
// carry /api and /auth to the Worker).
app.post("/api/newsletter/subscribe", async (c) => {
  const b = await c.req.json().catch(() => ({} as { email?: string }));
  const email = String(b.email || "").trim().toLowerCase();
  // Always answer ok, no email enumeration; the UNIQUE index absorbs duplicates.
  if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ ok: true });
  await c.env.DB.prepare(
    `INSERT INTO subscribers (email, opted, source) VALUES (?1, 1, 'landing')
     ON CONFLICT(email) DO UPDATE SET opted = 1`)
    .bind(email).run().catch(() => {});
  return c.json({ ok: true });
});

app.get("/api/newsletter/unsub", async (c) => {
  const failPage = unsubPage("That link didn't work",
    "This unsubscribe link is invalid or expired. If you still want out, use the link in a newer email.");
  try {
    const e = c.req.query("e") || "";
    const sig = c.req.query("sig") || "";
    const email = new TextDecoder().decode(b64urlDecode(e)).trim().toLowerCase();
    if (!email || !sig || !(await verifyUnsubSig(c.env, email, sig))) {
      return c.html(failPage, 400);
    }
    await c.env.DB.prepare("UPDATE subscribers SET opted = 0 WHERE email = ?1").bind(email).run();
    const u = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email)
      .first<{ id: string }>();
    if (u?.id) {
      await c.env.DB.prepare(
        "UPDATE profiles SET newsletter_opt = 0 WHERE user_id = ?1").bind(u.id).run();
    }
    return c.html(unsubPage("You're unsubscribed",
      "You won't get any more newsletters from Emblem. Changed your mind? You can re-subscribe anytime from the app or the website footer."));
  } catch {
    return c.html(failPage, 400);
  }
});

// Voice WebSocket → a fresh Durable Object per session (holds both sockets alive).
app.get("/api/voice/live", (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("expected websocket", 426);
  }
  const id = c.env.VOICE.newUniqueId();
  return c.env.VOICE.get(id).fetch(c.req.raw);
});


app.route("/auth", authRoutes);
app.route("/api", fileRoutes);
app.route("/api", apiRoutes);

// Log real errors to `wrangler tail`; return a generic message to the client.
app.onError((err, c) => {
  console.log("ERROR", c.req.method, c.req.path, "-", err instanceof Error ? err.message : String(err));
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

// Everything else → static assets (the Svelte app; SPA fallback via wrangler config).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(heartbeat(env)),
} satisfies ExportedHandler<Env>;
