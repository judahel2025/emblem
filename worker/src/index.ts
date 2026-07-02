// Emblem — the whole backend as one Cloudflare Worker.
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
export { VoiceRelay } from "./voice_do";

const app = new Hono<{ Bindings: Env }>();

// Allow the frontend origin — Vercel-hosted app (emblem.thequaniac.com + preview
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

// Never reveal what powers Emblem — health is name + readiness only.
app.get("/api/health", (c) => c.json({ name: "Emblem", status: "online", ready: true }));

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
