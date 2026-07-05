// Thin client for the Emblem Worker API. The Worker serves this app same-origin,
// so in the browser the API base is simply "" — the one exception is the Tauri
// desktop shell, which loads from a local file and must be pointed at the Worker.
import { speechify } from "./speech.js";

const CLOUD_URL = "https://emblem.thequaniac.com";

function resolveBase() {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("emblem_url");
  if (stored) return stored.replace(/\/$/, "");
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ ||
    (location.protocol || "").startsWith("tauri") || location.hostname === "tauri.localhost";
  if (isTauri) return CLOUD_URL;   // desktop shell → hosted Worker
  return "";                       // browser → same origin (Worker serves the app)
}
export let API_BASE = resolveBase();
export function setApiBase(url) {
  API_BASE = (url || "").replace(/\/$/, "");
  if (url) localStorage.setItem("emblem_url", API_BASE);
  else localStorage.removeItem("emblem_url");
}

function authHeaders() {
  const token = typeof localStorage !== "undefined" && localStorage.getItem("emblem_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path, options = {}) {
  const { signal, ...rest } = options;
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...rest,
    ...(signal ? { signal } : {}),
  });
  if (res.status === 401) {
    // Session expired/invalid — let the shell sign out cleanly.
    window.dispatchEvent(new CustomEvent("emblem:session-expired"));
    throw new ApiError(path, 401, "signed out");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(path, res.status, body.error || `request failed (${res.status})`);
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(path, status, message) {
    super(message);
    this.path = path;
    this.status = status;
  }
}

const get = (p) => req(p);
const post = (p, body) => req(p, { method: "POST", body: JSON.stringify(body || {}) });
const del = (p) => req(p, { method: "DELETE" });

export const api = {
  health: () => get("/api/health"),
  kernelStatus: () => get("/api/kernel/status"),
  tools: () => get("/api/tools"),
  execute: (name, args, approval_id = null) =>
    post("/api/tools/execute", { name, args, approval_id }),

  approvals: () => get("/api/approvals"),
  decide: (id, approved, note = "") =>
    post(`/api/approvals/${id}/decide`, { approved, note }),

  audit: (limit = 100) => get(`/api/audit?limit=${limit}`),
  snapshots: () => get("/api/snapshots"),
  restore: (id) => post(`/api/snapshots/${id}/restore`),

  secrets: () => get("/api/secrets"),
  setSecret: (name, value) => post("/api/secrets", { name, value }),
  deleteSecret: (name) => del(`/api/secrets/${encodeURIComponent(name)}`),

  config: () => get("/api/config"),
  killSwitch: (on) => post("/api/config/kill-switch", { on }),
  localOnly: (on) => post("/api/config/local-only", { on }),
  approvalMode: (mode) => post("/api/config/approval-mode", { mode }),
  setTrust: (tool, on) => post("/api/config/trust", { tool, on }),

  lockStatus: () => get("/api/lock"),
  lockVerify: (password) => post("/api/lock/verify", { password }),
  lockSet: (password, current = "") => post("/api/lock/set", { password, current }),
  lockDisable: (password) => post("/api/lock/disable", { password }),
  agent: (command, context = {}, signal = null) =>
    req("/api/agent", { method: "POST", body: JSON.stringify({ command, context }), signal }),
  brain: () => get("/api/brain"),
  setBrain: (cfg) => post("/api/brain", cfg),
  notes: () => get("/api/notes"),
  noteAdd: (body) => post("/api/notes", body),
  noteUpdate: (id, patch) => req(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  noteDelete: (id) => del(`/api/notes/${id}`),

  memory: () => get("/api/memory"),
  memoryAdd: (content, kind = "fact") => post("/api/memory", { content, kind }),
  memoryUpdate: (id, patch) => req(`/api/memory/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  memoryDelete: (id) => del(`/api/memory/${id}`),
  alerts: () => get("/api/alerts"),
  alertSeen: (id) => post(`/api/alerts/${id}/seen`, {}),
  improvements: () => get("/api/improvements"),
  improvementResolve: (id) => post(`/api/improvements/${id}/resolve`, {}),
  conversations: (limit = 100, threadId = null) =>
    get(`/api/conversations?limit=${limit}${threadId ? `&thread_id=${threadId}` : ""}`),
  conversationAdd: (role, text, threadId = null) =>
    post("/api/conversations", { role, text, thread_id: threadId }),
  conversationsClear: () => del("/api/conversations"),

  // Threads (ChatGPT-style conversation list)
  threads: () => get("/api/threads"),
  threadCreate: (title = "New chat") => post("/api/threads", { title }),
  threadRename: (id, title) => req(`/api/threads/${id}`, { method: "PUT", body: JSON.stringify({ title }) }),
  threadAutotitle: (id, prompt) => post(`/api/threads/${id}/autotitle`, { prompt }),
  threadDelete: (id) => del(`/api/threads/${id}`),
  emails: (status = "") => get(`/api/emails${status ? `?status=${status}` : ""}`),
  emailDraft: (recipient, subject, body) => post("/api/tools/execute", { name: "email.draft", args: { recipient, subject, body } }),
  emailSend: (id) => post(`/api/emails/${id}/send`, {}),
  emailArchive: (id) => post(`/api/emails/${id}/archive`, {}),
  emailRestore: (id) => post(`/api/emails/${id}/restore`, {}),
  emailDelete: (id) => del(`/api/emails/${id}`),

  async analyzeUpload(file, token) {
    const fd = new FormData();
    fd.append("file", file);
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(API_BASE + "/api/analyze/upload", { method: "POST", headers, body: fd });
    return res.json();
  },

  codeList: () => get("/api/code"),
  codeSave: (path, content, language = "", name = "") => post("/api/code", { path, content, language, name }),
  codeGet: ({ path = "", name = "" }) => get(`/api/code/get?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`),
  codeSearch: (q) => get(`/api/code/search?q=${encodeURIComponent(q)}`),

  schedule: () => get("/api/schedule"),
  scheduleCancel: (id) => post(`/api/schedule/${id}/cancel`, {}),
  schedulePause: (id, paused) => post(`/api/schedule/${id}/pause`, { paused }),

  filesAll: () => get("/api/files/all"),
  async fileUpload(name, blob) {
    const res = await fetch(`${API_BASE}/api/files/upload?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream", ...authHeaders() },
      body: blob,
    });
    return res.json().catch(() => ({ ok: res.ok }));
  },
  skills: () => get("/api/skills"),
  skill: (path) => get(`/api/skill?path=${encodeURIComponent(path)}`),

  voiceConfig: () => get("/api/voice/config"),
  voiceSetConfig: (cfg) => post("/api/voice/config", cfg),
  voiceVoices: (engine = "edge") => get(`/api/voice/voices?engine=${engine}`),
  async ttsUrl(text, voice, rate, engine) {
    // Use Gemini TTS if engine is "gemini"
    if (engine === "gemini") {
      const res = await fetch(API_BASE + "/api/voice/gemini-tts", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text: speechify(text), voice: voice || "en-US-Studio-O" }),
      });
      if (!res.ok) throw new Error("gemini tts failed");
      return URL.createObjectURL(await res.blob());
    }
    const res = await fetch(API_BASE + "/api/voice/tts", {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text: speechify(text), voice, rate, engine }),
    });
    if (!res.ok) throw new Error("tts failed");
    return URL.createObjectURL(await res.blob());
  },
  // Turn-based voice: one utterance → text (Groq Whisper, Gemini fallback).
  async transcribe(blob, mime) {
    const fd = new FormData();
    fd.append("audio", blob, (mime || "").includes("mp4") ? "clip.mp4" : "clip.webm");
    const res = await fetch(API_BASE + "/api/voice/transcribe", {
      method: "POST", headers: authHeaders(), body: fd,   // browser sets the multipart boundary
    });
    return res.json();
  },

  // Reviews (user side)
  reviewChat: (history) => post("/api/reviews/chat", { history }),
  reviewSubmit: (text) => post("/api/reviews", { text }),

  // Newsletter (user side + public landing subscribe)
  newsletterState: () => get("/api/newsletter/state"),
  newsletterOpt: (choice) => post("/api/newsletter/opt", { choice }),
  newsletterSubscribe: (email) => post("/api/newsletter/subscribe", { email }),

  // Admin console (owner only — 404s for everyone else)
  adminUsers: () => get("/api/admin/users"),
  adminReviews: () => get("/api/admin/reviews"),
  adminReviewRead: (id) => post(`/api/admin/reviews/${id}/read`, {}),
  adminNewsChat: (history, draft) => post("/api/admin/newsletter/chat", { history, draft }),
  adminNewsRecipients: () => get("/api/admin/newsletter/recipients"),
  adminNewsTest: (subject, html) => post("/api/admin/newsletter/test", { subject, html }),
  adminNewsSend: (subject, html) => post("/api/admin/newsletter/send", { subject, html }),
  adminNewsHistory: () => get("/api/admin/newsletter/history"),
  adminNewsDomain: () => get("/api/admin/newsletter/domain"),
  adminNewsDomainRegister: () => post("/api/admin/newsletter/domain/register", {}),

  inboxDeleteAll: () => req("/api/inbox/delete_all", { method: "POST", body: JSON.stringify({ confirm: true }) }),
  inboxUndo: () => req("/api/inbox/undo", { method: "POST", body: JSON.stringify({}) }),
  inboxCheckNow: () => req("/api/mail/inbound", { method: "POST", body: JSON.stringify({}) }),

  models: () => get("/api/models"),
  chat: (prompt, model, mode) => post("/api/chat", { prompt, model, mode }),

  // Connections (per-user)
  connections: () => get("/api/connections"),
  connectionLink: (toolkit) => get(`/api/connections/link?toolkit=${encodeURIComponent(toolkit)}`),
  connectionDisconnect: (toolkit) => post("/api/connections/disconnect", { toolkit }),

  // Pages (Notion-style)
  pages: () => get("/api/pages"),
  pageGet: (id) => get(`/api/pages/${id}`),
  pageCreate: (title, blocks = [], icon = "") => post("/api/pages", { title, blocks, icon }),
  pageUpdate: (id, patch) => req(`/api/pages/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  pageDelete: (id) => del(`/api/pages/${id}`),

  // Calendar
  calendar: () => get("/api/calendar"),
  eventAdd: (e) => post("/api/calendar", e),
  eventDelete: (id) => del(`/api/calendar/${id}`),

  // Automations
  automations: () => get("/api/automations"),
  automationAdd: (title, instruction, every = "day") => post("/api/automations", { title, instruction, every }),
  automationToggle: (id, enabled) => post(`/api/automations/${id}/toggle`, { enabled }),
  automationDelete: (id) => del(`/api/automations/${id}`),

  // Notifications
  notifications: () => get("/api/notifications"),
  notificationsPoll: () => post("/api/notifications/poll", {}),
  notificationRead: (id) => post(`/api/notifications/${id}/read`, {}),
  notificationsReadAll: () => post("/api/notifications/read-all", {}),
  notificationDelete: (id) => del(`/api/notifications/${id}`),

  // Proactive grounding (one real-signal line on app open)
  briefing: () => get("/api/briefing"),

  // AI onboarding (text engine) + personalized suggestions
  onboardingChat: (history) => post("/api/onboarding/chat", { history }),
  onboardingExtract: (history) => post("/api/onboarding/extract", { history }),
  onboardingForm: (fields) => post("/api/onboarding/form", { fields }),
  suggestions: (refresh = false) => get(`/api/suggestions${refresh ? "?refresh=1" : ""}`),
  async speechUrl(text) {
    const res = await fetch(API_BASE + "/api/voice/tts", {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      // speechify strips markdown/links so TTS never reads asterisks aloud
      body: JSON.stringify({ text: speechify(text) }),
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

  // Skills
  skills: () => get("/api/skills"),
  skillCreate: (skill) => post("/api/skills", skill),
  skillUpdate: (id, patch) => req(`/api/skills/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  skillDelete: (id) => del(`/api/skills/${id}`),
  skillDraft: (description, paste = false) => post("/api/skills/draft", { description, paste }),

  // Identity + profile
  me: () => get("/api/me"),
  profile: () => get("/api/me/profile"),
  profileSet: (patch) => req("/api/me/profile", { method: "PUT", body: JSON.stringify(patch) }),
};
