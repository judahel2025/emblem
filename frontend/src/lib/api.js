// Thin client for the kernel-backed API (proxied to FastAPI :8788 in dev).
import { speechify } from "./speech.js";

const RENDER_URL = "https://emblem-k6mg.onrender.com";

function isMobileDevice() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent);
}

// Where's the engine? Stored override > Tauri local > dev proxy (localhost) >
// same-origin when served BY the backend > cloud URL for any other host (Pages, custom domains).
function resolveBase() {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("emblem_url");
  if (stored) return stored.replace(/\/$/, "");
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ ||
    (location.protocol || "").startsWith("tauri") || location.hostname === "tauri.localhost";
  if (isTauri) return "http://127.0.0.1:8788";
  const h = location.hostname || "";
  if (h === "localhost" || h === "127.0.0.1") return "";   // vite dev proxy
  if (h.endsWith(".onrender.com")) return "";              // served same-origin by the backend
  return RENDER_URL;                                       // Pages / any separate frontend origin
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
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...options,
  });
  if (!res.ok && res.status >= 500) throw new Error(`${path} -> ${res.status}`);
  return res.json();
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
  agent: (command, context = {}) => post("/api/agent", { command, context }),
  brain: () => get("/api/brain"),
  setBrain: (cfg) => post("/api/brain", cfg),
  notes: () => get("/api/notes"),
  noteAdd: (body) => post("/api/notes", body),
  noteUpdate: (id, patch) => req(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  noteDelete: (id) => del(`/api/notes/${id}`),

  memory: () => get("/api/memory"),
  memoryAdd: (content, kind = "fact") => post("/api/memory", { content, kind }),
  alerts: () => get("/api/alerts"),
  alertSeen: (id) => post(`/api/alerts/${id}/seen`, {}),
  improvements: () => get("/api/improvements"),
  improvementResolve: (id) => post(`/api/improvements/${id}/resolve`, {}),
  conversations: (limit = 100) => get(`/api/conversations?limit=${limit}`),
  conversationAdd: (role, text) => post("/api/conversations", { role, text }),
  conversationsClear: () => del("/api/conversations"),
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
  async sttBlob(blob) {
    const fd = new FormData();
    fd.append("audio", blob, "clip.webm");
    const res = await fetch(API_BASE + "/api/voice/stt", { method: "POST", body: fd });
    return res.json();
  },

  inboxDeleteAll: () => req("/api/inbox/delete_all", { method: "POST", body: JSON.stringify({ confirm: true }) }),
  inboxUndo: () => req("/api/inbox/undo", { method: "POST", body: JSON.stringify({}) }),
  inboxCheckNow: () => req("/api/mail/inbound", { method: "POST", body: JSON.stringify({}) }),

  models: () => get("/api/models"),
  chat: (prompt, model, mode) => post("/api/chat", { prompt, model, mode }),

  // Connections (Composio, per-user)
  connections: () => get("/api/connections"),
  connectionLink: (toolkit) => get(`/api/connections/link?toolkit=${encodeURIComponent(toolkit)}`),

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

  // Identity + profile
  me: () => get("/api/me"),
  profile: () => get("/api/profile"),
  profileSet: (patch) => post("/api/profile", patch),
};
