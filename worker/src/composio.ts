// Composio v3 REST, per-user app connections (Gmail, GitHub, Calendar, socials).
// Same verified flow as the Python port: auth_configs → connected_accounts/link →
// tools → execute. Reads run free; actions pass the kernel DANGER gate.

import type { Env } from "./env";
import { registerTool, getConfig, setConfig } from "./kernel";

const BASE = "https://backend.composio.dev/api/v3";

export const FEATURED_TOOLKITS = [
  "gmail", "googlecalendar", "github", "youtube",
  "instagram", "facebook", "linkedin", "twitter", "whatsapp", "notion", "slack",
];

// Toolkits Composio does NOT provide managed auth for: the user must bring their
// own developer app credentials. Verified against the live catalog (2026-07-14):
// twitter has composio_managed_auth_schemes = []. Emblem collects these through
// the in-app credential dialog and stores them as a custom auth_config.
// Each field: name = Composio credential key, label/hint = what the user sees.
export interface CredField { name: string; label: string; hint?: string; }
export const CUSTOM_CRED_TOOLKITS: Record<string, { authScheme: string; fields: CredField[] }> = {
  twitter: {
    authScheme: "OAUTH2",
    fields: [
      { name: "client_id", label: "Client ID", hint: "OAuth 2.0 Client ID from your X Developer app" },
      { name: "client_secret", label: "Client Secret", hint: "OAuth 2.0 Client Secret from the same app" },
      { name: "generic_id", label: "Bearer Token", hint: "Bearer Token from your X Developer app (same app as above)" },
    ],
  },
};

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

// Raised when a toolkit needs the user's own developer credentials and none are
// on file yet. The connections route turns this into a "collect credentials"
// response so the frontend can pop the credential dialog instead of erroring.
export class CredentialsNeeded extends Error {
  constructor(public toolkit: string, public fields: CredField[]) {
    super(`${toolkit} needs developer credentials`);
    this.name = "CredentialsNeeded";
  }
}

// Does this toolkit already have a usable auth config? (managed, or a custom one
// the user previously set up.) Used by the connections UI to decide whether to
// show the credential form before connecting.
async function findAuthConfig(env: Env, slug: string): Promise<string | null> {
  const list = await cf(env, `/auth_configs?toolkit_slug=${slug}&limit=10`) as
    { items?: Array<{ id: string; is_composio_managed?: boolean; status?: string }> };
  const items = (list.items || []).filter((a) => a.status !== "DISABLED");
  const pick = items.find((a) => a.is_composio_managed) || items[0];
  return pick?.id || null;
}

async function authConfigFor(env: Env, toolkit: string): Promise<string> {
  const slug = toolkit.toLowerCase();
  const cached = authConfigCache.get(slug);
  if (cached) return cached;
  const existing = await findAuthConfig(env, slug);
  if (existing) { authConfigCache.set(slug, existing); return existing; }
  // No config yet. Toolkits without managed auth CANNOT be auto-created, they
  // need the user's own credentials (collected via the dialog, see createCustomAuthConfig).
  if (CUSTOM_CRED_TOOLKITS[slug]) {
    throw new CredentialsNeeded(slug, CUSTOM_CRED_TOOLKITS[slug].fields);
  }
  const created = await cf(env, "/auth_configs", {
    method: "POST",
    body: JSON.stringify({ toolkit: { slug }, auth_config: { type: "use_composio_managed_auth" } }),
  }) as { auth_config?: { id?: string } };
  const id = created.auth_config?.id || null;
  if (!id) throw new Error(`Could not find or create auth config for ${toolkit}`);
  authConfigCache.set(slug, id);
  return id;
}

// Create a CUSTOM auth config from user-supplied developer credentials, then
// remember it so future connects for this toolkit skip the dialog entirely.
export async function createCustomAuthConfig(env: Env, toolkit: string,
    credentials: Record<string, string>): Promise<string> {
  const slug = toolkit.toLowerCase();
  const spec = CUSTOM_CRED_TOOLKITS[slug];
  if (!spec) throw new Error(`${toolkit} does not take custom credentials.`);
  const missing = spec.fields.filter((f) => !String(credentials[f.name] || "").trim());
  if (missing.length) throw new Error(`Missing: ${missing.map((f) => f.label).join(", ")}`);
  const creds: Record<string, string> = {};
  for (const f of spec.fields) creds[f.name] = String(credentials[f.name]).trim();
  const created = await cf(env, "/auth_configs", {
    method: "POST",
    body: JSON.stringify({
      toolkit: { slug },
      auth_config: {
        name: `${slug}-emblem`,
        type: "use_custom_auth",
        auth_scheme: spec.authScheme,
        credentials: creds,
      },
    }),
  }) as { auth_config?: { id?: string } };
  const id = created.auth_config?.id || null;
  if (!id) throw new Error(`Could not create ${toolkit} auth config with those credentials.`);
  authConfigCache.set(slug, id);
  return id;
}

// True when the toolkit needs the user's own credentials AND none exist yet.
export async function needsCredentials(env: Env, toolkit: string): Promise<CredField[] | null> {
  const slug = toolkit.toLowerCase();
  if (!CUSTOM_CRED_TOOLKITS[slug]) return null;
  if (authConfigCache.get(slug)) return null;
  const existing = await findAuthConfig(env, slug).catch(() => null);
  if (existing) { authConfigCache.set(slug, existing); return null; }
  return CUSTOM_CRED_TOOLKITS[slug].fields;
}

export async function initiateConnection(env: Env, toolkit: string, userId: string): Promise<string> {
  const acid = await authConfigFor(env, toolkit);
  const res = await cf(env, "/connected_accounts/link", {
    method: "POST", body: JSON.stringify({ auth_config_id: acid, user_id: userId }),
  }) as { redirect_url?: string };
  if (!res.redirect_url) throw new Error(`Failed to generate redirect URL for ${toolkit}`);
  return res.redirect_url;
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

// Active + broken (expired/failed) connections in one pass, the agent needs both:
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

// Disconnect: revoke every connected account this user holds for a toolkit.
// Scoped to the user's OWN accounts (user_ids filter) so one user can never
// revoke another's. Returns how many were removed.
export async function disconnect(env: Env, userId: string, toolkit: string): Promise<number> {
  const slug = String(toolkit || "").toLowerCase().trim();
  if (!slug) return 0;
  let removed = 0;
  try {
    const res = await cf(env,
      `/connected_accounts?user_ids=${encodeURIComponent(userId)}&toolkit_slugs=${slug}&limit=50`) as
      { items?: Array<{ id?: string; toolkit?: { slug?: string } }> };
    for (const a of res.items || []) {
      if (!a.id) continue;
      if (a.toolkit?.slug && String(a.toolkit.slug).toLowerCase() !== slug) continue;
      try { await cf(env, `/connected_accounts/${a.id}`, { method: "DELETE" }); removed++; }
      catch { /* skip one, keep going */ }
    }
  } catch { /* nothing to remove */ }
  return removed;
}

export async function allToolkits(env: Env): Promise<string[]> {
  if (!toolkitsCache.length) {
    try {
      const p1 = await cf(env, "/toolkits?limit=1000") as { items?: Array<{ slug?: string }>, next_cursor?: string };
      const items = [...(p1.items || [])];
      if (p1.next_cursor) {
        const p2 = await cf(env, `/toolkits?limit=1000&cursor=${p1.next_cursor}`) as { items?: Array<{ slug?: string }> };
        items.push(...(p2.items || []));
      }
      toolkitsCache = items.map((t) => String(t.slug || "").toLowerCase()).filter(Boolean);
    } catch { /* leave empty */ }
  }
  const featured = FEATURED_TOOLKITS.filter((t) => !toolkitsCache.length || toolkitsCache.includes(t));
  return [...featured, ...toolkitsCache.filter((n) => !FEATURED_TOOLKITS.includes(n)).sort()];
}

const MAX_PER_TOOLKIT = 15;
const MAX_TOTAL = 90;

// Slugs that MUST be in the agent's tool list whenever the toolkit is connected, // `important=true` sometimes omits the very actions users ask for by name
// (LinkedIn posting was invisible to the model for exactly this reason).
// Every slug here is VERIFIED against the live catalog, never guess these.
const PINNED_SLUGS: Record<string, string[]> = {
  gmail: ["GMAIL_SEND_EMAIL", "GMAIL_FETCH_EMAILS", "GMAIL_REPLY_TO_THREAD"],
  googlecalendar: ["GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_EVENTS_LIST"],
  github: ["GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", "GITHUB_GET_A_REPOSITORY"],
  linkedin: ["LINKEDIN_CREATE_LINKED_IN_POST", "LINKEDIN_GET_MY_INFO", "LINKEDIN_GET_COMPANY_INFO"],
  twitter: ["TWITTER_CREATION_OF_A_POST", "TWITTER_USER_LOOKUP_ME", "TWITTER_USER_LOOKUP_BY_USERNAME",
            "TWITTER_USER_HOME_TIMELINE_BY_USER_ID", "TWITTER_RETWEET_POST", "TWITTER_RECENT_SEARCH"],
  x: ["TWITTER_CREATION_OF_A_POST", "TWITTER_USER_LOOKUP_ME", "TWITTER_USER_LOOKUP_BY_USERNAME",
      "TWITTER_USER_HOME_TIMELINE_BY_USER_ID", "TWITTER_RETWEET_POST", "TWITTER_RECENT_SEARCH"],
  instagram: ["INSTAGRAM_CREATE_MEDIA_CONTAINER", "INSTAGRAM_CREATE_POST", "INSTAGRAM_GET_USER_MEDIA",
              "INSTAGRAM_GET_USER_INFO", "INSTAGRAM_REPLY_TO_COMMENT", "INSTAGRAM_SEND_TEXT_MESSAGE"],
  facebook: ["FACEBOOK_CREATE_POST", "FACEBOOK_CREATE_PHOTO_POST", "FACEBOOK_GET_PAGE_POSTS", "FACEBOOK_GET_USER_PAGES"],
  whatsapp: ["WHATSAPP_SEND_MESSAGE", "WHATSAPP_SEND_MEDIA", "WHATSAPP_GET_PHONE_NUMBERS",
             "WHATSAPP_GET_BUSINESS_PROFILE", "WHATSAPP_SEND_TEMPLATE_MESSAGE"],
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
    throw new Error("Your LinkedIn connection is missing or has expired, reconnect LinkedIn and I'll pick this right back up.");
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

// Fake/placeholder image hosts that social platforms reject ("media couldn't be
// fetched"). If a post's media URL points at one of these, fail EARLY with a clear
// message instead of a cryptic platform error, the model must use a real image.
const PLACEHOLDER_HOSTS = /(via\.placeholder\.com|placeholder\.com|placehold\.co|dummyimage\.com|example\.com|lorempixel|placekitten|placebear|fakeimg)/i;
function assertRealMedia(slug: string, args: Record<string, unknown>) {
  const s = slug.toUpperCase();
  if (!/INSTAGRAM|FACEBOOK|TWITTER|LINKEDIN|YOUTUBE|PIN/.test(s)) return;
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v !== "string" || !/url|image|media|photo|video|thumbnail/i.test(k)) continue;
    if (PLACEHOLDER_HOSTS.test(v)) {
      throw new Error("That post used a placeholder/example image, which the platform " +
        "rejects. Post with a REAL, publicly-viewable image, ask the user to attach a photo " +
        "or give a public image URL. Never invent an image link.");
    }
  }
}

export async function executeComposio(env: Env, userId: string, slug: string,
                                       args: Record<string, unknown>): Promise<unknown> {
  const upper = slug.toUpperCase();
  assertRealMedia(upper, args || {});
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
      throw new Error(`Your ${label} connection is missing or has expired, reconnect it and I'll pick this right back up.`);
    }
    throw e;
  }
  if (res.successful === false) throw new Error(res.error || "The connected app returned an error.");
  return res.data ?? res;
}

// Slug fragments that mean "read-only", everything else is consequential.
const READ_HINTS = ["GET_", "_GET", "LIST", "FETCH", "SEARCH", "READ", "FIND",
                    "RETRIEVE", "_INFO", "PROFILE", "STATS", "COUNT", "CHECK"];
export const isReadOnly = (slug: string) =>
  READ_HINTS.some((h) => slug.toUpperCase().includes(h));

// Human summaries for approval cards, the user must see WHAT happens in WHOSE
// account, never a raw tool slug.
const TOOLKIT_LABELS: Record<string, string> = {
  gmail: "Gmail", googlecalendar: "Google Calendar", github: "GitHub", youtube: "YouTube",
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", twitter: "X (Twitter)",
  x: "X (Twitter)", whatsapp: "WhatsApp", notion: "Notion", slack: "Slack",
};

export function humanizeSlug(slug: string, p: Record<string, unknown> = {}): string {
  const s = slug.toUpperCase();
  const str = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim()) ? String(p[k]).trim() : "";
  switch (s) {
    case "GMAIL_SEND_EMAIL": {
      const to = str("recipient_email") || str("to") || "a recipient";
      const subj = str("subject");
      return `Send email to ${to}${subj ? `, “${subj.slice(0, 60)}”` : ""} via your Gmail`;
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
      return `Publish a post on your LinkedIn${body ? `, “${body.slice(0, 70)}…”` : ""}`;
    }
    case "TWITTER_CREATION_OF_A_POST": {
      const body = str("text");
      const replyTo = str("reply__in__reply__to__tweet__id");
      return `${replyTo ? "Reply on" : "Post on"} your X (Twitter)${body ? `, “${body.slice(0, 70)}…”` : ""}`;
    }
    case "TWITTER_RETWEET_POST":
      return `Retweet a post on X (Twitter)`;
    case "INSTAGRAM_CREATE_POST":
    case "INSTAGRAM_CREATE_MEDIA_CONTAINER":
      return `Publish a post on your Instagram${str("caption") ? `, “${str("caption").slice(0, 60)}…”` : ""}`;
    case "INSTAGRAM_REPLY_TO_COMMENT":
      return "Reply to a comment on Instagram";
    case "INSTAGRAM_SEND_TEXT_MESSAGE":
      return `Send Instagram DM${str("username") || str("recipient_id") ? ` to ${str("username") || str("recipient_id")}` : ""}`;
    case "FACEBOOK_CREATE_POST":
    case "FACEBOOK_CREATE_PHOTO_POST":
      return `Publish a post on your Facebook Page${str("message") ? `, “${str("message").slice(0, 60)}…”` : ""}`;
    case "WHATSAPP_SEND_MESSAGE":
      return `Send a WhatsApp message${str("to_number") ? ` to ${str("to_number")}` : ""}${str("text") ? `, “${str("text").slice(0, 60)}…”` : ""}`;
    case "WHATSAPP_SEND_MEDIA":
      return `Send WhatsApp media${str("to_number") ? ` to ${str("to_number")}` : ""}`;
    case "WHATSAPP_SEND_TEMPLATE_MESSAGE":
      return `Send a WhatsApp template message${str("to_number") ? ` to ${str("to_number")}` : ""}`;
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

// Kernel gateway tools, every connected-app call passes the same gate as native tools.
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
