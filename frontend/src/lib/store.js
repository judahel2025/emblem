import { writable, derived, get } from "svelte/store";
import { api } from "./api.js";

// --- the surface ---------------------------------------------------------------
export const mode = writable("converse");      // converse | make | pulse | guard
export const makeTab = writable("code");        // code | ai
export const ideFullscreen = writable(false);   // IDE/AI takes the whole window
export const editorInbox = writable(null);      // agent pushes code into the editor
export const termInbox = writable(null);         // agent pushes a command into the terminal
export const fileToView = writable(null);        // agent opens a doc in the Files viewer
export const pulseTab = writable("money");      // money | inbox | content | research
export const guardTab = writable("approvals");  // approvals | activity | security
export const filesTab = writable("files");      // files | notes | memory | skills

// --- conversation / voice ------------------------------------------------------
export const messages = writable([]);
export const thinking = writable(false);
export const voiceState = writable("idle");     // idle | listening | thinking | speaking
export const voiceLive = writable(false);       // mic stays on until toggled off
export const model = writable("llama3.2:3b");

// --- live system ---------------------------------------------------------------
export const health = writable(null);
export const config = writable({ kill_switch: false, local_only: false, approval_mode: "ask", remembered_approvals: [] });
export const approvals = writable({ pending: [], recent: [] });
export const auditLog = writable([]);
export const models = writable([]);
export const toast = writable(null);
export const briefing = writable(null);   // startup greeting + recent alerts
export const installEvent = writable(null);   // captured PWA beforeinstallprompt
export const voiceCfg = writable({ engine: "edge", voice: "en-US-AriaNeural", rate: "+0%" });

// --- identity: who am I, and am I the admin/operator? ----------------------------
// Everything owner-flavored in the UI keys off me.is_admin; regular users get a
// clean personal workspace with none of the operator surfaces.
export const me = writable({ user_id: null, is_admin: false, display_name: "", onboarded: false });
let _meLoaded = false;
export async function loadMe() {
  if (_meLoaded) return get(me);
  try {
    const r = await api.me();
    if (r && r.user_id !== undefined) { me.set(r); _meLoaded = true; }
  } catch {}
  return get(me);
}

// --- theme — always dark -------------------------------------------------------
export const darkMode = writable(true);

export const pendingCount = derived(approvals, ($a) => $a.pending?.length || 0);
export const brainReady = derived(health, ($h) => !!($h?.ready ?? $h?.brain?.ready));
export const brainLabel = derived(health, ($h) => $h?.brain?.label || "brain");
export const depth = derived(messages, ($m) => ($m.length ? "split" : "ambient"));

let toastTimer;
export function notify(message, kind = "info") {
  toast.set({ message, kind });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), 3200);
}

// --- speech control: Veyra can always be cut off mid-sentence --------------------
let _speaking = null;   // the Audio element currently playing a reply/briefing
export function stopSpeaking() {
  if (_speaking) { try { _speaking.pause(); _speaking.currentTime = 0; } catch {} _speaking = null; }
  if (get(voiceState) === "speaking") voiceState.set("idle");
}
// Speak text, first stopping anything already playing (so a new ask interrupts).
export async function speakText(text, cfg = {}) {
  stopSpeaking();
  const t = (text || "").trim();
  if (!t) return;
  try {
    const url = await api.ttsUrl(t, cfg.voice, cfg.rate, cfg.engine);
    const a = new Audio(url);
    _speaking = a;
    voiceState.set("speaking");
    a.onended = () => { if (_speaking === a) { _speaking = null; voiceState.set("idle"); } };
    a.onerror = (e) => {
      if (_speaking === a) { _speaking = null; voiceState.set("idle"); }
      notify("Voice playback failed — check your audio output", "danger");
    };
    await a.play();
  } catch (err) {
    voiceState.set("idle");
    notify(`Voice error: ${err?.message || err}`, "danger");
  }
}

export async function refresh() {
  const admin = get(me).is_admin;
  // Everyone: health, their own approvals, their own alerts.
  // Admin only: safety config + the audit trail (operator surfaces; 404 for users).
  const [h, appr] = await Promise.all([
    api.health().catch(() => null),
    api.approvals().catch(() => ({ pending: [], recent: [] })),
  ]);
  if (h) health.set(h);
  approvals.set(appr);
  if (admin) {
    const [cfg, aud] = await Promise.all([
      api.config().catch(() => ({})),
      api.audit(60).catch(() => ({ items: [] })),
    ]);
    config.set({ kill_switch: false, local_only: false, approval_mode: "ask", remembered_approvals: [], ...cfg });
    auditLog.set(aud.items || []);
  }
  checkAlerts();
}

// Veyra comes alive: when an alert arrives (new support mail, signup, product change), she
// speaks up unprompted in the conversation and offers to act — then marks the alert seen.
let _alertBusy = false;
async function checkAlerts() {
  if (_alertBusy) return;
  _alertBusy = true;
  try {
    const r = await api.alerts().catch(() => ({ items: [] }));
    const items = r.items || [];
    for (const al of items) {
      const line = _alertLine(al);
      messages.update((m) => [...m, { role: "assistant", text: line, alert: true }]);
      notify(al.title || "New activity", al.kind === "support" ? "accent" : "safe");
      if (!get(thinking)) speakText(line);
      await api.alertSeen(al.id).catch(() => {});
    }
  } catch {}
  _alertBusy = false;
}
function _alertLine(al) {
  const admin = get(me).is_admin;
  if (al.kind === "support")
    return admin
      ? `Master Judah — ${al.title}. ${al.body} Want me to draft a reply?`
      : `${al.title}. ${al.body}`;
  if (al.kind === "signup")
    return admin
      ? `Good news, Master Judah — ${al.title}: ${al.body}.`
      : `${al.title}: ${al.body}.`;
  return `${al.title}. ${al.body}`;
}

// Bring back the recent conversation so Veyra (and Judah) pick up where they left off.
let _convoLoaded = false;
export async function loadConversation() {
  if (_convoLoaded) return;
  _convoLoaded = true;
  try {
    const r = await api.conversations(60);
    const items = (r.items || []).map((m) => ({ role: m.role, text: m.text }));
    if (items.length) messages.set(items);
  } catch {}
}

// Inbox poller — fires desktop notification + speech when new email arrives.
let _lastUnreadCount = -1;
let _knownIds = new Set();

async function _pollInbox() {
  try {
    const r = await api.mailMessages("unread", 20);
    const count = r.unread || 0;
    const items = r.items || [];
    if (_lastUnreadCount >= 0 && count > _lastUnreadCount) {
      const fresh = items.filter((m) => !_knownIds.has(m.id));
      for (const m of fresh) {
        const senderName = (m.from_addr || "someone").split("@")[0].replace(/[._+]/g, " ");
        const subject = m.subject || "(no subject)";
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`New email from ${senderName}`, { body: subject });
        }
        notify(`New email from ${senderName}: ${subject}`, "accent");
        if (!get(thinking)) {
          speakText(`New email from ${senderName}. Subject: ${subject}.`, get(voiceCfg));
        }
      }
    }
    _lastUnreadCount = count;
    _knownIds = new Set(items.map((m) => m.id));
  } catch {}
}

export function startInboxPoller() {
  // The mailroom (Resend inbox) is the operator's — no poller for regular users.
  if (!get(me).is_admin) return 0;
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  }
  _pollInbox();
  return setInterval(_pollInbox, 30_000);
}

// When Veyra comes on: greet, brief, and (best-effort) speak it. Runs once.
let _briefed = false;
export async function loadBriefing(speak = true) {
  if (_briefed) return;
  _briefed = true;
  const my = get(me);
  if (!my.is_admin) {
    // Users get a simple personal greeting — the operator briefing is the admin's.
    const name = my.display_name ? `, ${my.display_name}` : "";
    briefing.set({ greeting: `Welcome back${name}.`, summary: "" });
    return;
  }
  const r = await api.briefing().catch(() => null);
  const b = r && (r.result || r);
  if (!b || b.ok === false) return;
  briefing.set(b);
  if (speak && (b.greeting || b.summary)) {
    const text = [b.greeting, b.summary].filter(Boolean).join(" ");
    await speakText(text);          // interruptible; may be blocked until first gesture
  }
}

// Execute the UI actions the agent returns (open editor + write, run terminal, etc.).
const TAB_STORE = { make: makeTab, files: filesTab, pulse: pulseTab, guard: guardTab };

function goTo(m, tab) {
  if (m) mode.set(m);
  if (tab && TAB_STORE[m]) TAB_STORE[m].set(tab);
}

function runActions(actions) {
  for (const a of actions || []) {
    if (a.type === "editor.write") {
      editorInbox.set({ path: a.path, content: a.content, language: a.language });
      goTo("make", "code");
    } else if (a.type === "terminal.run") {
      termInbox.set(a.command); goTo("make", "code");
    } else if (a.type === "navigate") {
      goTo(a.mode || "converse", a.tab);
    } else if (a.type === "view_file") {
      goTo("files", "files");
      fileToView.set({ root: a.root || "documents", path: a.path });
    } else if (a.type === "file.created") {
      notify(`Saved ${a.path} to Files`, "safe");
    } else if (a.type === "note.added") {
      notify("Saved to your notes", "safe");
    } else if (a.type === "refresh") {
      refresh();
    } else if (a.type === "inbox.cleared") {
      notify(`Inbox cleared — ${a.count ?? ""} messages deleted`, "safe");
    } else if (a.type === "conversations.cleared") {
      messages.set([]);
      notify("Chat history cleared", "safe");
    }
  }
}

// Voice-command deletion helpers called by the agent via natural language
export async function clearInbox() {
  const r = await api.inboxDeleteAll().catch(() => ({ ok: false }));
  const count = r.deleted_count ?? r.deletedCount ?? "all";
  notify(`Inbox cleared — ${count} messages deleted`, "safe");
}

export async function clearConversations() {
  await api.conversationsClear().catch(() => {});
  messages.set([]);
  notify("Chat history cleared", "safe");
}

// Holds a clarifying-question task between turns (task continuation).
let pendingTask = null;

// Spoken or typed command — routed through the agent brain (intent -> action).
export async function sendCommand(text) {
  const clean = (text || "").trim();
  if (!clean || get(thinking)) return;
  stopSpeaking();
  const prior = get(messages);
  const lastReply = [...prior].reverse().find((m) => m.role === "assistant")?.text || "";
  const history = prior.slice(-12).map((m) => ({ role: m.role, content: m.text }));
  messages.update((m) => [...m, { role: "user", text: clean }]);
  api.conversationAdd("user", clean).catch(() => {});
  thinking.set(true);
  voiceState.set("thinking");
  const r = await api.agent(clean, { model: get(model), lastReply, history, pending: pendingTask })
    .catch((e) => ({ reply: String(e), actions: [] }));
  pendingTask = r.pending || null;
  const replyText = r.reply || "(no reply)";
  messages.update((m) => [...m, { role: "assistant", text: replyText }]);
  api.conversationAdd("assistant", replyText).catch(() => {});
  thinking.set(false);
  voiceState.set("idle");
  runActions(r.actions);
  refresh();
  return r;
}

// File/image attachment flow:
//  1. User bubble shows filename + optional image thumbnail (stays in Converse, no redirect)
//  2. Veyra acknowledges immediately ("Got it, reading…")
//  3. Agent receives the extracted content and replies with a short summary + intention question
export async function sendAttachment(fileName, fileType, extractedContent, imagePreview = null) {
  if (get(thinking)) return;
  stopSpeaking();

  const isImage = (fileType || "").startsWith("image/");
  const userLabel = isImage ? `[Image: ${fileName}]` : `[Document: ${fileName}]`;

  // 1. User bubble — show file card (+ image thumbnail if image)
  messages.update((m) => [...m, {
    role: "user",
    text: userLabel,
    imagePreview: imagePreview || null,
    attachmentName: fileName,
    isAttachment: true,
  }]);
  api.conversationAdd("user", userLabel).catch(() => {});

  // 2. Immediate Veyra acknowledgement — spoken + shown
  const ack = isImage
    ? `I've received the image ${fileName} — analysing it now.`
    : `I've received ${fileName} — reading through it now.`;
  messages.update((m) => [...m, { role: "assistant", text: ack, isAck: true }]);
  speakText(ack, get(voiceCfg));

  thinking.set(true);
  voiceState.set("thinking");

  const prior = get(messages);
  const lastReply = [...prior].filter((m) => m.role === "assistant" && !m.isAck).slice(-1)[0]?.text || "";
  const history = prior.filter((m) => !m.isAck).slice(-12).map((m) => ({ role: m.role, content: m.text }));

  // 3. Build agent prompt with extracted content — Veyra does the analysis
  const agentPrompt = isImage
    ? `The user uploaded an image called "${fileName}". Vision analysis result:\n\n${extractedContent}\n\nBriefly summarise what you see in 2–3 sentences, then ask what they'd like to do with it.`
    : `The user uploaded a document called "${fileName}". Full extracted content:\n\n---\n${extractedContent}\n---\n\nBriefly summarise the key points in 2–4 sentences, then ask what they'd like to do with it.`;

  const r = await api.agent(agentPrompt, { model: get(model), lastReply, history, pending: pendingTask })
    .catch((e) => ({ reply: String(e), actions: [] }));

  pendingTask = r.pending || null;
  const replyText = r.reply || "(no reply)";

  // Replace the ack message with the real response
  messages.update((m) => {
    const idx = [...m].reverse().findIndex((msg) => msg.isAck);
    if (idx === -1) return [...m, { role: "assistant", text: replyText }];
    const realIdx = m.length - 1 - idx;
    const updated = [...m];
    updated[realIdx] = { role: "assistant", text: replyText };
    return updated;
  });

  api.conversationAdd("assistant", replyText).catch(() => {});
  thinking.set(false);
  voiceState.set("idle");

  // Speak the summary response
  speakText(replyText, get(voiceCfg));

  // Persist document to memory so Veyra can refer back to it across sessions
  const memSummary = `Document "${fileName}" read on ${new Date().toLocaleDateString()}. Summary: ${replyText}`;
  api.memoryAdd(memSummary, "document").catch(() => {});
  // Store full content under a longer-form fact so the agent can retrieve it
  api.memoryAdd(`Full content of "${fileName}":\n\n${extractedContent.slice(0, 8000)}`, "document").catch(() => {});

  runActions(r.actions);
  refresh();
  return r;
}

export async function decide(id, approved) {
  await api.decide(id, approved);
  notify(approved ? `Approved #${id}` : `Rejected #${id}`, approved ? "safe" : "danger");
  await refresh();
}

export async function setFlag(flag, on) {
  if (flag === "kill_switch") await api.killSwitch(on);
  else if (flag === "local_only") await api.localOnly(on);
  notify(`${flag.replace("_", " ")} ${on ? "on" : "off"}`, on ? "caution" : "safe");
  await refresh();
}
