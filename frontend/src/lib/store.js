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

// --- app shell -------------------------------------------------------------------
// The active workspace screen. The agent (open_screen tool) and the tour drive this
// too, so it lives in a store rather than App.svelte local state.
export const appView = writable("chat");
export const showVoiceOverlay = writable(false);   // full-screen live voice (VoiceLive)

// The user's connected apps (toolkit slugs) — drives sidebar workspaces + tiles.
export const connectedApps = writable([]);
export async function loadConnections() {
  try {
    const r = await api.connections();
    connectedApps.set(r.connected || []);
  } catch (e) { console.error("loadConnections failed:", e); }
}

// --- threads (ChatGPT-style conversation list) -----------------------------------
export const threads = writable({ items: [], legacy_count: 0 });
export const activeThread = writable(null);   // null = fresh chat (thread made on first message)

export async function loadThreads() {
  try { threads.set(await api.threads()); }
  catch (e) { console.error("loadThreads failed:", e); }
}

export async function openThread(id) {
  activeThread.set(id);
  appView.set("chat");
  messages.set([]);
  try {
    const r = await api.conversations(100, id);
    messages.set((r.items || []).map((m) => ({ role: m.role, text: m.text })));
  } catch (e) { console.error("openThread failed:", e); }
}

export function newChat() {
  activeThread.set(null);
  messages.set([]);
  appView.set("chat");
}

export async function renameThread(id, title) {
  await api.threadRename(id, title).catch((e) => notify(`Couldn't rename: ${e.message}`, "danger"));
  loadThreads();
}

export async function deleteThread(id) {
  await api.threadDelete(id).catch((e) => notify(`Couldn't delete: ${e.message}`, "danger"));
  if (get(activeThread) === id) newChat();
  loadThreads();
}

// --- conversation / voice ------------------------------------------------------
export const messages = writable([]);
export const thinking = writable(false);        // waiting on the model (three-dot indicator)
export const writing = writable(false);         // typewriter reveal in progress
// One flag the composer keys off: while either is true, Send becomes Stop.
export const generating = derived([thinking, writing], ([$t, $w]) => $t || $w);
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
export async function loadMe(force = false) {
  if (_meLoaded && !force) return get(me);
  try {
    const r = await api.me();
    if (r && r.user_id !== undefined) { me.set(r); _meLoaded = true; }
  } catch (e) {
    console.error("loadMe failed:", e);
  }
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

// --- speech control: Emblem can always be cut off mid-sentence --------------------
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
    a.onerror = () => {
      if (_speaking === a) { _speaking = null; voiceState.set("idle"); }
    };
    await a.play();
  } catch (err) {
    // Spoken replies are an enhancement — a missing TTS backend must never toast.
    voiceState.set("idle");
    console.warn("tts unavailable:", err?.message || err);
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

// Emblem comes alive: when an alert arrives (new support mail, signup, product change), she
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

// ChatGPT behavior: boot lands on a FRESH chat with the thread list in the sidebar;
// past conversations open on click (including the pre-threads "Earlier" bucket).
let _convoLoaded = false;
export async function loadConversation() {
  if (_convoLoaded) return;
  _convoLoaded = true;
  loadThreads();
}

export async function openLegacy() {
  activeThread.set("legacy");
  appView.set("chat");
  messages.set([]);
  try {
    const r = await api.conversations(100, "legacy");
    messages.set((r.items || []).map((m) => ({ role: m.role, text: m.text })));
  } catch (e) { console.error("openLegacy failed:", e); }
}

// When Emblem comes on: a simple personal greeting. Runs once.
let _briefed = false;
export async function loadBriefing() {
  if (_briefed) return;
  _briefed = true;
  const my = get(me);
  const name = my.display_name ? `, ${my.display_name}` : "";
  briefing.set({ greeting: `Welcome back${name}.`, summary: "" });
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
      if (a.view) appView.set(a.view);        // app screens (chat/connect/pages/…)
      else goTo(a.mode || "converse", a.tab); // legacy mode navigation
    } else if (a.type === "open_url") {
      if (a.url) window.open(a.url, "_blank", "noopener");
    } else if (a.type === "connect.pending") {
      // Emblem handed the user a connect link in-chat. Open it, then watch the
      // connections list; the moment the toolkit turns ACTIVE, feed an internal
      // continuation back to the agent so it confirms + resumes — no user retype.
      if (a.url) window.open(a.url, "_blank", "noopener,width=600,height=760");
      if (a.toolkit) watchConnection(a.toolkit);
    } else if (a.type === "approval.pending") {
      notify(a.summary ? `Waiting for your approval: ${a.summary}` : "An action is waiting for your approval", "caution");
      refresh();
    } else if (a.type === "tool_error") {
      // A connected-app action failed — say so loudly instead of deflecting.
      notify(a.summary || "A connected app returned an error", "danger");
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

// --- generation control: abort the fetch, or halt the typewriter -----------------
let _abort = null;         // AbortController for the in-flight agent fetch
let _revealTimer = null;   // rAF id for the typewriter
let _revealCancel = null;  // halts the current reveal, keeping the partial text

// Reveal an assistant reply with a fast-but-visible typewriter. Pushes an empty
// assistant bubble, grows its text in place, and resolves with the text actually
// shown — the FULL reply normally, or the PARTIAL if the user hit Stop mid-reveal.
function revealAssistant(fullText) {
  return new Promise((resolve) => {
    messages.update((m) => [...m, { role: "assistant", text: "" }]);
    if (!fullText) { resolve(""); return; }
    writing.set(true);
    let shown = 0, cancelled = false;
    const perTick = Math.max(4, Math.ceil(fullText.length / 90));   // ~1.5s cap, always visible
    const paint = (n) => messages.update((m) => {
      const i = m.length - 1;
      if (i >= 0 && m[i].role === "assistant") m[i] = { ...m[i], text: fullText.slice(0, n) };
      return m;
    });
    const finish = (text) => {
      cancelled = true;
      if (_revealTimer) { cancelAnimationFrame(_revealTimer); _revealTimer = null; }
      _revealCancel = null;
      writing.set(false);
      resolve(text);
    };
    _revealCancel = () => finish(fullText.slice(0, shown));   // freeze at the partial
    const step = () => {
      if (cancelled) return;
      shown = Math.min(fullText.length, shown + perTick);
      paint(shown);
      if (shown >= fullText.length) return finish(fullText);
      _revealTimer = requestAnimationFrame(step);
    };
    _revealTimer = requestAnimationFrame(step);
  });
}

// The Stop button. Aborts a pending fetch (nothing shown yet) AND/OR freezes an
// in-progress reveal, keeping whatever text is on screen.
export function stopGeneration() {
  if (_abort) { try { _abort.abort(); } catch {} _abort = null; }
  if (_revealCancel) _revealCancel();
  thinking.set(false);
  voiceState.set("idle");
}

// Post an internal continuation to the agent — a system note that is NOT shown as
// a user bubble and NOT persisted as a user message; only the assistant reply is
// pushed + saved. Shared by decideAndContinue (approvals) and watchConnection.
export async function continueTask(command) {
  const prior = get(messages);
  const lastReply = [...prior].reverse().find((m) => m.role === "assistant")?.text || "";
  const history = prior.slice(-12).map((m) => ({ role: m.role, content: m.text }));
  const tid = get(activeThread);

  _abort = new AbortController();
  thinking.set(true);
  voiceState.set("thinking");
  let ar;
  try {
    ar = await api.agent(command, { model: get(model), lastReply, history, pending: pendingTask }, _abort.signal);
  } catch (e) {
    _abort = null;
    if (e?.name === "AbortError") { thinking.set(false); voiceState.set("idle"); return { reply: "", actions: [] }; }
    ar = { reply: String(e), actions: [] };
  }
  _abort = null;
  pendingTask = ar.pending || null;
  thinking.set(false);
  const shown = await revealAssistant(ar.reply || "(no reply)");
  api.conversationAdd("assistant", shown, tid).catch((e) => console.error("save msg:", e));
  voiceState.set("idle");
  runActions(ar.actions);
  refresh();
  return ar;
}

// Watch a just-started connection: poll the live connections list (same pattern as
// the Connectors screen — interval + window focus), and when the toolkit turns
// ACTIVE, tell the agent so it confirms and picks the task back up seamlessly.
const _watching = new Map();   // toolkit -> { timer, startedAt }
export function watchConnection(toolkit) {
  const tk = String(toolkit || "").toLowerCase();
  if (!tk || _watching.has(tk)) return;
  const POLL_MS = 3000, TIMEOUT_MS = 3 * 60 * 1000;
  const startedAt = Date.now();

  const check = async () => {
    let live = [];
    try { live = (await api.connections()).connected || []; }
    catch { return; }                       // transient — next tick retries
    if (live.includes(tk)) {
      stop();
      connectedApps.set(live);
      loadConnections();
      const label = tk.charAt(0).toUpperCase() + tk.slice(1);
      notify(`${label} connected`, "safe");
      if (!get(thinking)) {
        continueTask(`[system note — not typed by the user] They just finished connecting ${tk}. ` +
          `It is now active. Confirm you detect the connection in one short sentence, then continue ` +
          `the task you were doing without asking them to repeat anything.`);
      }
    } else if (Date.now() - startedAt > TIMEOUT_MS) {
      stop();
    }
  };
  const stop = () => {
    const w = _watching.get(tk);
    if (w) { clearInterval(w.timer); window.removeEventListener("focus", check); _watching.delete(tk); }
  };
  const timer = setInterval(check, POLL_MS);
  window.addEventListener("focus", check);
  _watching.set(tk, { timer, startedAt });
}

// Spoken or typed command — routed through the agent brain (intent -> action).
export async function sendCommand(text) {
  const clean = (text || "").trim();
  if (!clean || get(thinking) || get(writing)) return;
  stopSpeaking();

  // First message of a fresh chat creates its thread. It shows the raw message
  // instantly, then a model-generated 3–6 word title replaces it in the sidebar.
  let tid = get(activeThread);
  if (!tid) {
    try {
      const t = await api.threadCreate(clean.slice(0, 60));
      tid = t.id;
      activeThread.set(tid);
      loadThreads();
      api.threadAutotitle(tid, clean)
        .then(() => loadThreads())
        .catch((e) => console.warn("autotitle failed:", e));
    } catch (e) { console.error("thread create failed:", e); }
  }

  const prior = get(messages);
  const lastReply = [...prior].reverse().find((m) => m.role === "assistant")?.text || "";
  const history = prior.slice(-12).map((m) => ({ role: m.role, content: m.text }));
  messages.update((m) => [...m, { role: "user", text: clean }]);
  api.conversationAdd("user", clean, tid).catch((e) => console.error("save msg:", e));

  _abort = new AbortController();
  thinking.set(true);
  voiceState.set("thinking");
  let r;
  try {
    r = await api.agent(clean, { model: get(model), lastReply, history, pending: pendingTask }, _abort.signal);
  } catch (e) {
    _abort = null;
    // User hit Stop before the reply arrived — leave the chat as-is, no bubble.
    if (e?.name === "AbortError") { thinking.set(false); voiceState.set("idle"); return { reply: "", actions: [] }; }
    r = { reply: String(e), actions: [] };
  }
  _abort = null;
  pendingTask = r.pending || null;
  thinking.set(false);
  const shown = await revealAssistant(r.reply || "(no reply)");
  api.conversationAdd("assistant", shown, tid).catch((e) => console.error("save msg:", e));
  voiceState.set("idle");
  runActions(r.actions);
  refresh();
  return r;
}

// File/image attachment flow:
//  1. User bubble shows filename + optional image thumbnail (stays in Converse, no redirect)
//  2. Emblem acknowledges immediately ("Got it, reading…")
//  3. Agent receives the extracted content and replies with a short summary + intention question
export async function sendAttachment(fileName, fileType, extractedContent, imagePreview = null) {
  if (get(thinking) || get(writing)) return;
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

  // 2. Immediate Emblem acknowledgement — spoken + shown
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

  // 3. Build agent prompt with extracted content — Emblem does the analysis
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

  // Persist document to memory so Emblem can refer back to it across sessions
  const memSummary = `Document "${fileName}" read on ${new Date().toLocaleDateString()}. Summary: ${replyText}`;
  api.memoryAdd(memSummary, "document").catch(() => {});
  // Store full content under a longer-form fact so the agent can retrieve it
  api.memoryAdd(`Full content of "${fileName}":\n\n${extractedContent.slice(0, 8000)}`, "document").catch(() => {});

  runActions(r.actions);
  refresh();
  return r;
}

// Approve/decline a pending action AND close the loop in the conversation:
// api.decide runs the tool server-side (resolveApproval executes it and returns
// its result), then an internal continuation is sent to the agent so Emblem
// reports the outcome in-chat — no more "approved… now what?" dead ends.
// The internal command is never shown as a user bubble and never persisted as
// a user message; only the assistant's reply is pushed + saved.
const _deciding = new Set();
export async function decideAndContinue(id, approved, summary = "") {
  if (_deciding.has(id)) return { ok: false, error: "already deciding" };
  _deciding.add(id);
  try {
    summary = summary
      || (get(approvals).pending || []).find((p) => p.id === id)?.summary
      || "the pending action";

    let r;
    try { r = await api.decide(id, approved); }
    catch (e) { r = { ok: false, error: e?.message || String(e) }; }

    notify(approved ? `Approved #${id}` : `Declined #${id}`, approved ? "safe" : "info");
    const tid = get(activeThread);

    // Approve failed (tool threw, already decided, …) — surface it, no continuation.
    if (approved && !r.ok) {
      const line = `That action failed: ${r.error || "unknown error"}`;
      messages.update((m) => [...m, { role: "assistant", text: line }]);
      api.conversationAdd("assistant", line, tid).catch((e) => console.error("save msg:", e));
      refresh();
      return r;
    }

    // Internal continuation — same history shape sendCommand builds.
    const command = approved
      ? `[system note — not typed by the user] They approved the pending action "${summary}". Result: ${JSON.stringify(r.result ?? null).slice(0, 1500)}. Confirm the outcome to the user in one short sentence (mention any id/link), and continue the task if anything was left unfinished.`
      : `[system note — not typed by the user] They declined the action "${summary}". Acknowledge briefly and offer an alternative if there is one.`;

    // Loop guard: if this continuation itself queues a NEW approval, continueTask's
    // runActions just notifies + refreshes so the new card renders — we never
    // auto-decide, so there is no recursion. decideAndContinue only runs on click.
    await continueTask(command);
    return r;
  } finally {
    _deciding.delete(id);
  }
}

// Thin alias kept for existing callers.
export function decide(id, approved) {
  return decideAndContinue(id, approved);
}

export async function setFlag(flag, on) {
  if (flag === "kill_switch") await api.killSwitch(on);
  else if (flag === "local_only") await api.localOnly(on);
  notify(`${flag.replace("_", " ")} ${on ? "on" : "off"}`, on ? "caution" : "safe");
  await refresh();
}
