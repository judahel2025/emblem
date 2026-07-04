// Composio v3 REST — per-user app connections (Gmail, GitHub, Calendar, socials).
// Same verified flow as the Python port: auth_configs → connected_accounts/link →
// tools → execute. Reads run free; actions pass the kernel DANGER gate.

import type { Env } from "./env";
import { registerTool, getConfig, setConfig } from "./kernel";

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

// Active + broken (expired/failed) connections in one pass — the agent needs both:
// active ones it can use, broken ones it should offer to reconnect instead of
// treating as "not connected".
export async function connectionStates(env: Env, userId: string):
    Promise<{ active: string[]; broken: string[] }> {
  try {
    const res = await cf(env, `/connected_accounts?user_ids=${encodeURIComponent(userId)}&limit=100`) as
      { items?: Array<{ status?: string; toolkit?: { slug?: string } }> };
    const active = new Set<string>(), seen = new Set<string>();
    for (const a of res.items || []) {
      const slug = a.toolkit?.slug ? String(a.toolkit.slug).toLowerCase() : "";
      if (!slug) continue;
      seen.add(slug);
      if (a.status === "ACTIVE") active.add(slug);
    }
    return { active: [...active].sort(),
             broken: [...seen].filter((s) => !active.has(s)).sort() };
  } catch { return { active: [], broken: [] }; }
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
const MAX_TOTAL = 90;

// Slugs that MUST be in the agent's tool list whenever the toolkit is connected —
// `important=true` sometimes omits the very actions users ask for by name
// (LinkedIn posting was invisible to the model for exactly this reason).
// Every slug here is VERIFIED against the live catalog — never guess these.
const PINNED_SLUGS: Record<string, string[]> = {
  gmail: ["GMAIL_SEND_EMAIL", "GMAIL_FETCH_EMAILS", "GMAIL_REPLY_TO_THREAD"],
  googlecalendar: ["GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_EVENTS_LIST"],
  github: ["GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", "GITHUB_GET_A_REPOSITORY"],
  linkedin: ["LINKEDIN_CREATE_LINKED_IN_POST", "LINKEDIN_GET_MY_INFO"],
  twitter: ["TWITTER_CREATION_OF_A_POST"],
  instagram: ["INSTAGRAM_CREATE_POST", "INSTAGRAM_GET_USER_MEDIA"],
  facebook: ["FACEBOOK_CREATE_POST", "FACEBOOK_GET_PAGE_POSTS"],
  notion: ["NOTION_ADD_PAGE_CONTENT", "NOTION_SEARCH_NOTION_PAGE"],
  slack: ["SLACK_SEND_MESSAGE", "SLACK_CHAT_POST_MESSAGE"],
  youtube: ["YOUTUBE_UPLOAD_VIDEO", "YOUTUBE_SEARCH_YOU_TUBE"],
};

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
      const items = [...(res.items || [])];
      // Merge pinned slugs the importance filter missed.
      const have = new Set(items.map((t) => String(t.slug)));
      const missing = (PINNED_SLUGS[tk] || []).filter((s) => !have.has(s));
      if (missing.length) {
        try {
          const pinned = await cf(env, `/tools?toolkit_slug=${tk}&tool_slugs=${missing.join(",")}`) as
            { items?: Array<Record<string, unknown>> };
          items.unshift(...(pinned.items || []));
        } catch { /* pinned fetch is best-effort */ }
      }
      for (const t of items) {
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

// ---- LinkedIn override --------------------------------------------------------
// Composio's hosted LinkedIn tool pins a sunset LinkedIn-Version header (20241101),
// so LinkedIn answers 426 NONEXISTENT_VERSION on every post. Until they fix it we
// run LinkedIn calls ourselves through Composio's authenticated proxy with a live
// version header. The first version LinkedIn accepts is cached in kernel_config,
// so the candidate walk happens at most once per LinkedIn sunset cycle.

const LI_VERSION_KEY = "linkedin_api_version";
const LI_VERSIONS = ["202506", "202505", "202504", "202503", "202502", "202501", "202412"];
const LINKEDIN_OVERRIDES = new Set([
  "LINKEDIN_CREATE_LINKED_IN_POST", "LINKEDIN_DELETE_LINKED_IN_POST", "LINKEDIN_GET_MY_INFO",
]);

async function activeAccountId(env: Env, userId: string, toolkit: string): Promise<string | null> {
  try {
    const res = await cf(env,
      `/connected_accounts?user_ids=${encodeURIComponent(userId)}&toolkit_slugs=${toolkit}&limit=20`) as
      { items?: Array<{ id?: string; status?: string }> };
    return (res.items || []).find((a) => a.status === "ACTIVE")?.id || null;
  } catch { return null; }
}

interface ProxyResult { data?: unknown; status?: number; headers?: Record<string, string> }

async function proxyCall(env: Env, accountId: string, method: string, endpoint: string,
                         body?: unknown, headers?: Record<string, string>): Promise<ProxyResult> {
  const parameters = Object.entries(headers || {})
    .map(([name, value]) => ({ name, value, type: "header" }));
  return await cf(env, "/tools/execute/proxy", {
    method: "POST",
    body: JSON.stringify({ connected_account_id: accountId, endpoint, method,
                           ...(body !== undefined ? { body } : {}), parameters }),
  }) as ProxyResult;
}

async function executeLinkedIn(env: Env, userId: string, slug: string,
                               args: Record<string, unknown>): Promise<unknown> {
  const accountId = await activeAccountId(env, userId, "linkedin");
  if (!accountId) {
    throw new Error("Your LinkedIn connection is missing or has expired — reconnect LinkedIn and I'll pick this right back up.");
  }

  if (slug === "LINKEDIN_GET_MY_INFO") {
    const r = await proxyCall(env, accountId, "GET", "https://api.linkedin.com/v2/userinfo");
    const d = (r.data || {}) as Record<string, unknown>;
    return { ...d, author_id: d.sub ? `urn:li:person:${d.sub}` : undefined };
  }

  let req: { method: string; endpoint: string; body?: unknown };
  if (slug === "LINKEDIN_DELETE_LINKED_IN_POST") {
    const urn = String(args.share_urn || args.post_urn || args.urn || args.id || "");
    if (!urn) throw new Error("Which post should I delete? I need its URN (e.g. urn:li:share:…).");
    req = { method: "DELETE",
            endpoint: `https://api.linkedin.com/rest/posts/${encodeURIComponent(urn)}` };
  } else {
    const commentary = String(args.commentary ?? args.text ?? args.content ?? "");
    if (!commentary.trim()) throw new Error("The post needs text (commentary).");
    let author = String(args.author || "");
    if (!author) {
      const me = await proxyCall(env, accountId, "GET", "https://api.linkedin.com/v2/userinfo");
      const sub = ((me.data || {}) as { sub?: string }).sub;
      if (!sub) throw new Error("Couldn't read your LinkedIn profile to determine the post author.");
      author = `urn:li:person:${sub}`;
    }
    req = { method: "POST", endpoint: "https://api.linkedin.com/rest/posts",
            body: { author, commentary,
                    visibility: String(args.visibility || "PUBLIC"),
                    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [],
                                    thirdPartyDistributionChannels: [] },
                    lifecycleState: String(args.lifecycle_state || "PUBLISHED"),
                    isReshareDisabledByAuthor: Boolean(args.is_reshare_disabled_by_author ?? false) } };
  }

  const cached = await getConfig(env, LI_VERSION_KEY, "").catch(() => "");
  const candidates = [...new Set([cached, ...LI_VERSIONS].filter(Boolean))];
  let lastErr = "";
  for (const v of candidates) {
    let r: ProxyResult;
    try {
      r = await proxyCall(env, accountId, req.method, req.endpoint, req.body, {
        "LinkedIn-Version": v, "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      });
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); continue; }
    const status = Number(r.status ?? 0);
    if (status === 426) { lastErr = `LinkedIn API version ${v} is no longer active.`; continue; }
    if (status >= 200 && status < 300) {
      if (v !== cached) await setConfig(env, LI_VERSION_KEY, v).catch(() => {});
      const d = (r.data || {}) as Record<string, unknown>;
      const urn = r.headers?.["x-restli-id"] || r.headers?.["X-Restli-Id"] || d.id || "";
      return { successful: true, post_urn: urn || undefined, data: d };
    }
    throw new Error(`LinkedIn returned ${status}: ${JSON.stringify(r.data ?? {}).slice(0, 300)}`);
  }
  throw new Error(lastErr || "LinkedIn rejected every API version tried.");
}

export async function executeComposio(env: Env, userId: string, slug: string,
                                       args: Record<string, unknown>): Promise<unknown> {
  const upper = slug.toUpperCase();
  if (LINKEDIN_OVERRIDES.has(upper)) return executeLinkedIn(env, userId, upper, args || {});
  let res: { successful?: boolean; error?: string; data?: unknown };
  try {
    res = await cf(env, `/tools/execute/${slug}`, {
      method: "POST", body: JSON.stringify({ user_id: userId, arguments: args || {} }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A dead connection must read as "reconnect me", never as a raw 4xx.
    if (/not in an ACTIVE state|No connected account found/i.test(msg)) {
      const tk = upper.split("_")[0].toLowerCase();
      const label = TOOLKIT_LABELS[tk] || tk;
      throw new Error(`Your ${label} connection is missing or has expired — reconnect it and I'll pick this right back up.`);
    }
    throw e;
  }
  if (res.successful === false) throw new Error(res.error || "The connected app returned an error.");
  return res.data ?? res;
}

// Slug fragments that mean "read-only" — everything else is consequential.
const READ_HINTS = ["GET_", "_GET", "LIST", "FETCH", "SEARCH", "READ", "FIND",
                    "RETRIEVE", "_INFO", "PROFILE", "STATS", "COUNT", "CHECK"];
export const isReadOnly = (slug: string) =>
  READ_HINTS.some((h) => slug.toUpperCase().includes(h));

// Human summaries for approval cards — the user must see WHAT happens in WHOSE
// account, never a raw tool slug.
const TOOLKIT_LABELS: Record<string, string> = {
  gmail: "Gmail", googlecalendar: "Google Calendar", github: "GitHub", youtube: "YouTube",
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", twitter: "X (Twitter)",
  notion: "Notion", slack: "Slack",
};

export function humanizeSlug(slug: string, p: Record<string, unknown> = {}): string {
  const s = slug.toUpperCase();
  const str = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim()) ? String(p[k]).trim() : "";
  switch (s) {
    case "GMAIL_SEND_EMAIL": {
      const to = str("recipient_email") || str("to") || "a recipient";
      const subj = str("subject");
      return `Send email to ${to}${subj ? ` — “${subj.slice(0, 60)}”` : ""} via your Gmail`;
    }
    case "GMAIL_REPLY_TO_THREAD":
      return `Reply${str("recipient_email") ? ` to ${str("recipient_email")}` : ""} in your Gmail`;
    case "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS": {
      const repo = [str("owner"), str("repo")].filter(Boolean).join("/");
      return `Commit ${str("path") || "a file"}${repo ? ` to ${repo}` : ""}${str("branch") ? ` (${str("branch")})` : ""} on your GitHub`;
    }
    case "GOOGLECALENDAR_CREATE_EVENT":
      return `Add “${(str("summary") || str("title") || "an event").slice(0, 60)}” to your Google Calendar`;
    case "LINKEDIN_CREATE_LINKED_IN_POST": {
      const body = str("commentary") || str("text") || str("content");
      return `Publish a post on your LinkedIn${body ? ` — “${body.slice(0, 70)}…”` : ""}`;
    }
    case "TWITTER_CREATION_OF_A_POST":
      return `Post on your X (Twitter)${str("text") ? ` — “${str("text").slice(0, 70)}…”` : ""}`;
    case "INSTAGRAM_CREATE_POST":
      return "Publish a post on your Instagram";
    case "FACEBOOK_CREATE_POST":
      return "Publish a post on your Facebook";
    case "SLACK_SEND_MESSAGE":
    case "SLACK_CHAT_POST_MESSAGE":
      return `Send a Slack message${str("channel") ? ` to ${str("channel")}` : ""}`;
  }
  // Generic fallback: "Create issue in your GitHub" from the slug's toolkit + verb words.
  const toolkit = Object.keys(TOOLKIT_LABELS).find((k) => s.startsWith(k.toUpperCase() + "_"));
  const action = (toolkit ? s.slice(toolkit.length + 1) : s)
    .toLowerCase().replace(/_/g, " ").replace(/^an? /, "");
  return toolkit ? `${action.charAt(0).toUpperCase()}${action.slice(1)} in your ${TOOLKIT_LABELS[toolkit]}`
                 : `${action.charAt(0).toUpperCase()}${action.slice(1)} in a connected app`;
}

// Kernel gateway tools — every connected-app call passes the same gate as native tools.
registerTool({
  name: "composio.read",
  tier: "safe",
  description: "Read from a connected app (Gmail, Calendar, GitHub, socials)",
  summarize: (a) => humanizeSlug(String(a.slug), (a.params as Record<string, unknown>) || {}),
  handler: (a, env, userId) =>
    executeComposio(env, userId, String(a.slug), (a.params as Record<string, unknown>) || {}),
});

registerTool({
  name: "composio.act",
  tier: "danger",
  description: "Take an action in a connected app (send, post, create, delete)",
  summarize: (a) => humanizeSlug(String(a.slug), (a.params as Record<string, unknown>) || {}),
  handler: (a, env, userId) =>
    executeComposio(env, userId, String(a.slug), (a.params as Record<string, unknown>) || {}),
});
