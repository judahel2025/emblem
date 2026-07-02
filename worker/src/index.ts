// Emblem — the whole backend as one Cloudflare Worker.
// Serves the Svelte app (static assets, same origin), the /api REST surface,
// the /auth endpoints, the /api/voice/live WebSocket relay, and the cron heartbeat.

import { Hono } from "hono";
import type { Env } from "./env";
import { authRoutes } from "./auth";
import { apiRoutes } from "./api";
import { voiceRelay } from "./voice";
import { heartbeat } from "./cron";

const app = new Hono<{ Bindings: Env }>();

// Never reveal what powers Emblem — health is name + readiness only.
app.get("/api/health", (c) => c.json({ name: "Emblem", status: "online", ready: true }));

// Voice WebSocket must be handled before generic routing (needs raw upgrade).
app.get("/api/voice/live", (c) => voiceRelay(c.req.raw, c.env));

app.route("/auth", authRoutes);
app.route("/api", apiRoutes);

// Everything else → static assets (the Svelte app; SPA fallback via wrangler config).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(heartbeat(env)),
} satisfies ExportedHandler<Env>;
