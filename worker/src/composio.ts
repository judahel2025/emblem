// Composio v3 REST — per-user app connections (Gmail, GitHub, Calendar, socials).
// Same verified flow as the Python port: auth_configs → connected_accounts/link →
// tools → execute. Reads run free; actions pass the kernel DANGER gate.

import type { Env } from "./env";
import { registerTool } from "./kernel";

const BASE = "https://backend.composio.dev/api/v3";

export const FEATURED_TOOLKITS = [
  "gmail", "googlecalendar", "github", "youtube",
  "instagram", "facebook", "linkedin", "twitter", "notion", "slack",
];

const authConfigCache = new Map<string, string>();
let toolkitsCache: string[] = [];

async function cf(env: Env, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-api-key": env.COMPOSIO_KEY || "", "Content-Type": "application/json",
               ...(init?.headers || {}) },
  });
  const data = await res.json<Record<string, unknown>>().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string } }).error;
    throw new Error(err?.message || `HTTP ${res.status}`);
  }
  return data;
}

export const configured = (env: Env) => Boolean(env.COMPOSIO_KEY);

async function authConfigFor(env: Env, toolkit: string): Promise<string | null> {
  const slug = toolkit.toLowerCase();
  const cached = authConfigCache.get(slug);
  if (cached) return cached;
  try {
    const list = await cf(env, `/auth_configs?toolkit_slug=${slug}&limit=10`) as
      { items?: Array<{ id: string; is_composio_managed?: boolean }> };
    const pick = (list.items || []).find((a) => a.is_composio_managed) || (list.items || [])[0];
    if (pick) { authConfigCache.set(slug, pick.id); return pick.id; }
    const created = await cf(env, "/auth_configs", {
      method: "POST",
      body: JSON.stringify({ toolkit: { slug }, auth_config: { type: "use_composio_managed_auth" } }),
    }) as { auth_config?: { id?: string } };
    const id = created.auth_config?.id || null;
    if (id) authConfigCache.set(slug, id);
    return id;
  } catch { return null; }
}

export async function initiateConnection(env: Env, toolkit: string, userId: string): Promise<string | null> {
  const acid = await authConfigFor(env, toolkit);
  if (!acid) return null;
  try {
    const res = await cf(env, "/connected_accounts/link", {
      method: "POST", body: JSON.stringify({ auth_config_id: acid, user_id: userId }),
    }) as { redirect_url?: string };
    return res.redirect_url || null;
  } catch { return null; }
}

export async function listConnections(env: Env, userId: string): Promise<string[]> {
  try {
    const res = await cf(env, `/connected_accounts?user_ids=${encodeURIComponent(userId)}&limit=100`) as
      { items?: Array<{ status?: string; toolkit?: { slug?: string } }> };
    return [...new Set((res.items || [])
      .filter((a) => a.status === "ACTIVE" && a.toolkit?.slug)
      .map((a) => String(a.toolkit!.slug).toLowerCase()))].sort();
  } catch { return []; }
}

export async function allToolkits(env: Env): Promise<string[]> {
  if (!toolkitsCache.length) {
    try {
      const res = await cf(env, "/toolkits?limit=500") as { items?: Array<{ slug?: string }> };
      toolkitsCache = (res.items || []).map((t) => String(t.slug || "").toLowerCase()).filter(Boolean);
    } catch { /* leave empty */ }
  }
  const featured = FEATURED_TOOLKITS.filter((t) => !toolkitsCache.length || toolkitsCache.includes(t));
  return [...featured, ...toolkitsCache.filter((n) => !FEATURED_TOOLKITS.includes(n)).sort()];
}

const MAX_PER_TOOLKIT = 15;
const MAX_TOTAL = 60;

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export async function userTools(env: Env, userId: string): Promise<OpenAITool[]> {
  if (!configured(env)) return [];
  const connected = await listConnections(env, userId);
  const out: OpenAITool[] = [];
  for (const tk of connected) {
    if (out.length >= MAX_TOTAL) break;
    try {
      let res = await cf(env, `/tools?toolkit_slug=${tk}&limit=${MAX_PER_TOOLKIT}&important=true`) as
        { items?: Array<Record<string, unknown>> };
      if (!res.items?.length) {
        res = await cf(env, `/tools?toolkit_slug=${tk}&limit=${MAX_PER_TOOLKIT}`) as typeof res;
      }
      for (const t of res.items || []) {
        if (out.length >= MAX_TOTAL || !t.slug || t.is_deprecated) continue;
        out.push({ type: "function", function: {
          name: String(t.slug),
          description: String(t.description || t.name || t.slug).slice(0, 512),
          parameters: (t.input_parameters as Record<string, unknown>) || { type: "object", properties: {} },
        }});
      }
    } catch { /* skip toolkit */ }
  }
  return out;
}

export async function executeComposio(env: Env, userId: string, slug: string,
                                       args: Record<string, unknown>): Promise<unknown> {
  const res = await cf(env, `/tools/execute/${slug}`, {
    method: "POST", body: JSON.stringify({ user_id: userId, arguments: args || {} }),
  }) as { successful?: boolean; error?: string; data?: unknown };
  if (res.successful === false) throw new Error(res.error || "The connected app returned an error.");
  return res.data ?? res;
}

// Slug fragments that mean "read-only" — everything else is consequential.
const READ_HINTS = ["GET_", "_GET", "LIST", "FETCH", "SEARCH", "READ", "FIND",
                    "RETRIEVE", "_INFO", "PROFILE", "STATS", "COUNT", "CHECK"];
export const isReadOnly = (slug: string) =>
  READ_HINTS.some((h) => slug.toUpperCase().includes(h));

// Kernel gateway tools — every connected-app call passes the same gate as native tools.
registerTool({
  name: "composio.read",
  tier: "safe",
  description: "Read from a connected app (Gmail, Calendar, GitHub, socials)",
  summarize: (a) => `Read via ${a.slug}`,
  handler: (a, env, userId) =>
    executeComposio(env, userId, String(a.slug), (a.params as Record<string, unknown>) || {}),
});

registerTool({
  name: "composio.act",
  tier: "danger",
  description: "Take an action in a connected app (send, post, create, delete)",
  summarize: (a) => `Act via ${a.slug}`,
  handler: (a, env, userId) =>
    executeComposio(env, userId, String(a.slug), (a.params as Record<string, unknown>) || {}),
});
