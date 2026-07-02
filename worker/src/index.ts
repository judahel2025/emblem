// Emblem — the whole backend as one Cloudflare Worker.
// Serves the Svelte app (static assets, same origin), the /api REST surface,
// the /auth endpoints, the /api/voice/live WebSocket relay, and the cron heartbeat.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { authRoutes } from "./auth";
import { apiRoutes } from "./api";
import { voiceRelay } from "./voice";
import { heartbeat } from "./cron";
import "./tools";  // registers native tools with the kernel
import { fileRoutes } from "./r2";

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

// Voice WebSocket must be handled before generic routing (needs raw upgrade).
app.get("/api/voice/live", (c) => voiceRelay(c.req.raw, c.env, c.executionCtx));


app.route("/auth", authRoutes);
app.route("/api", fileRoutes);
app.route("/api", apiRoutes);

// Everything else → static assets (the Svelte app; SPA fallback via wrangler config).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(heartbeat(env)),
} satisfies ExportedHandler<Env>;
