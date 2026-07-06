// /auth/*, Emblem's own auth, entirely on the Worker.
//   POST /auth/signup   {email, password}         -> {token, user_id}
//   POST /auth/login    {email, password}         -> {token, user_id}
//   GET  /auth/google                             -> 302 Google consent
//   GET  /auth/google/callback?code=...           -> 302 /#emblem_token=<jwt>
//
// Sessions are Worker-signed HS256 JWTs (sub = user id). Passwords are
// PBKDF2-SHA256 (310k iterations, per-user salt). Google identity is verified
// server-side via Google's tokeninfo endpoint, no client-side trust.

import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Env } from "./env";
import { hashPassword, verifyPassword, signJwt, verifyJwt } from "./lib/crypto";

type Vars = { userId: string; isOwner: boolean };
export type AppContext = { Bindings: Env; Variables: Vars };

export const authRoutes = new Hono<AppContext>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function issue(c: Context<AppContext>, userId: string) {
  const token = await signJwt({ sub: userId }, c.env.JWT_SECRET);
  return { token, user_id: userId };
}

async function logAuth(env: Env, userId: string | null, kind: string, detail = "") {
  try {
    await env.DB.prepare("INSERT INTO auth_events (user_id, kind, detail) VALUES (?, ?, ?)")
      .bind(userId, kind, detail.slice(0, 200)).run();
  } catch { /* auth logging must never block auth */ }
}

authRoutes.post("/signup", async (c) => {
  const { email = "", password = "" } = await c.req.json().catch(() => ({}));
  const em = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(em)) return c.json({ error: "Enter a valid email address." }, 400);
  if (String(password).length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(em).first();
  if (existing) return c.json({ error: "That email already has an account, log in instead." }, 409);

  const id = crypto.randomUUID();
  const { hash, salt } = await hashPassword(String(password));
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, pw_hash, pw_salt, verified) VALUES (?, ?, ?, ?, 0)")
    .bind(id, em, hash, salt).run();
  await c.env.DB.prepare("INSERT INTO profiles (user_id) VALUES (?)").bind(id).run();
  await logAuth(c.env, id, "signup");
  return c.json(await issue(c, id));
});

authRoutes.post("/login", async (c) => {
  const { email = "", password = "" } = await c.req.json().catch(() => ({}));
  const em = String(email).trim().toLowerCase();
  const user = await c.env.DB.prepare(
    "SELECT id, pw_hash, pw_salt FROM users WHERE email = ?").bind(em)
    .first<{ id: string; pw_hash: string | null; pw_salt: string | null }>();
  if (!user?.pw_hash || !user.pw_salt) {
    await logAuth(c.env, null, "fail", `login:${em}`);
    return c.json({ error: "Email or password is incorrect." }, 401);
  }
  const ok = await verifyPassword(String(password), user.pw_salt, user.pw_hash);
  if (!ok) {
    await logAuth(c.env, user.id, "fail", "bad password");
    return c.json({ error: "Email or password is incorrect." }, 401);
  }
  await logAuth(c.env, user.id, "login");
  return c.json(await issue(c, user.id));
});

// ---- Google OAuth (authorization-code flow, verified server-side) ----------

function redirectUri(c: Context<AppContext>): string {
  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  return `${origin}/auth/google/callback`;
}

authRoutes.get("/google", (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: "Google sign-in isn't set up yet." }, 501);
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri(c));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("prompt", "select_account");
  return c.redirect(u.toString(), 302);
});

authRoutes.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect("/#auth_error=google", 302);
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c), grant_type: "authorization_code",
    }),
  });
  const tok = await tokenRes.json<{ id_token?: string }>().catch(() => ({} as { id_token?: string }));
  if (!tok.id_token) return c.redirect("/#auth_error=google", 302);

  // Let Google verify its own token, returns claims only when the signature is valid.
  const info = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tok.id_token)}`);
  const claims = await info.json<{ aud?: string; sub?: string; email?: string }>().catch(() => ({} as Record<string, never>));
  if (!info.ok || claims.aud !== c.env.GOOGLE_CLIENT_ID || !claims.sub || !claims.email) {
    return c.redirect("/#auth_error=google", 302);
  }

  const em = claims.email.toLowerCase();
  let user = await c.env.DB.prepare(
    "SELECT id FROM users WHERE google_sub = ? OR email = ?").bind(claims.sub, em)
    .first<{ id: string }>();
  if (!user) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, google_sub, verified) VALUES (?, ?, ?, 1)")
      .bind(id, em, claims.sub).run();
    await c.env.DB.prepare("INSERT INTO profiles (user_id) VALUES (?)").bind(id).run();
    user = { id };
  } else {
    await c.env.DB.prepare("UPDATE users SET google_sub = ?, verified = 1 WHERE id = ?")
      .bind(claims.sub, user.id).run();
  }
  await logAuth(c.env, user.id, "google");
  const { token } = await issue(c, user.id);
  return c.redirect(`/#emblem_token=${encodeURIComponent(token)}`, 302);
});

// ---- identity middleware (used by /api) -------------------------------------

export async function requireUser(c: Context<AppContext>, next: Next) {
  const header = c.req.header("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const payload = token ? await verifyJwt(token, c.env.JWT_SECRET) : null;
  const sub = payload && typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", sub);
  c.set("isOwner", Boolean(c.env.EMBLEM_OWNER_USER_ID && sub === c.env.EMBLEM_OWNER_USER_ID));
  await next();
}

/** Resolve a user id from a raw token string (for WebSocket query-param auth). */
export async function userFromToken(token: string, env: Env): Promise<string | null> {
  const payload = token ? await verifyJwt(token, env.JWT_SECRET) : null;
  return payload && typeof payload.sub === "string" ? payload.sub : null;
}
