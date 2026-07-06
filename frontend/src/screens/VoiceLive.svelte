<script>
  // Emblem's voice mode — full-screen conversation with the breathing mark.
  // DEFAULT ENGINE: Gemini Live (lib/live.js) — realtime, talk-and-respond-almost-
  // immediately, with a small set of SAFE tools (search, notes, memory, calendar,
  // automations) it can call directly. Anything consequential (send/post/etc.)
  // still runs through the normal agent + approval-card pipeline; this screen
  // surfaces any pending approval right here so voice mode is never a dead end —
  // tap it, or just say "yes"/"approve" or "no"/"decline" while it's showing.
  // Opt back into the turn-based STT pipeline for testing via
  // localStorage.emblem_voice_engine = "turns".
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { VoiceTurnClient } from "../lib/voiceturn.js";
  import { LiveClient } from "../lib/live.js";
  import { sendCommand, approvals, decideAndContinue, messages } from "../lib/store.js";
  import { get } from "svelte/store";
  import { api } from "../lib/api.js";
  import Orb from "../components/Orb.svelte";
  const dispatch = createEventDispatcher();

  let state = "connecting";
  let level = 0;
  let lines = [];
  let draft = "";
  let linesEl;
  let errorMsg = "";
  let needsAudioTap = false;
  let muted = false;

  function pushLine(who, text) {
    const last = lines[lines.length - 1];
    if (last && last.who === who) { last.text += text; lines = lines; }
    else lines = [...lines, { who, text }];
    if (lines.length > 8) lines = lines.slice(-8);
    queueMicrotask(() => { if (linesEl) linesEl.scrollTop = linesEl.scrollHeight; });
  }

  const events = {
    onState: (s) => (state = s),
    onCaption: ({ who, text }) => pushLine(who, text),
    onLevel: (l) => (level = l),
    onError: (m) => (errorMsg = m),
  };
  const useTurns = typeof localStorage !== "undefined" && localStorage.getItem("emblem_voice_engine") === "turns";
  const client = useTurns
    ? new VoiceTurnClient({
        mode: "chat",
        // The brain IS the normal agent loop — messages land in the thread,
        // tools run, approval cards render in the chat behind this overlay.
        onTranscript: async (text) => {
          const r = await sendCommand(text);
          return r?.reply || null;
        },
        ...events,
      })
    : new LiveClient({ mode: "chat", ...events });

  async function begin() {
    errorMsg = "";
    state = "connecting";
    await client.start({ mic: true });
    needsAudioTap = client.audioSuspended();
  }

  async function enableAudio() {
    try { await client.audioCtx?.resume(); } catch {}
    needsAudioTap = client.audioSuspended();
  }

  function toggleMute() {
    muted = !muted;
    client.setMuted?.(muted);
  }

  function sendDraft() {
    const t = draft.trim(); if (!t) return;
    draft = ""; pushLine("user", t); client.sendText(t);
  }

  function stop() { client.stop(); dispatch("close"); }
  onMount(begin);
  onDestroy(() => { client.stop(); try { apAudio?.pause(); } catch {} });

  $: label = muted ? "muted — tap the mic to resume" : ({
    connecting: "waking up…",
    listening: "listening — just talk",
    thinking: "thinking…",
    speaking: "",
    unavailable: errorMsg || "voice isn't available right now",
    error: errorMsg || "couldn't connect",
    ended: "session ended",
  }[state] ?? "");

  // ── Approvals, surfaced right here — never a silent dead end in voice mode ──
  let resolvedIds = new Set();
  let apBusy = false;
  let apAudio = null;
  $: pendingApproval = ($approvals.pending || []).find((p) => !resolvedIds.has(p.id)) || null;

  async function speakText(text) {
    try {
      const url = await api.speechUrl(text);
      if (!url) return;
      try { apAudio?.pause(); } catch {}
      apAudio = new Audio(url);
      await apAudio.play();
    } catch { /* captions already carry it */ }
  }

  async function decideVoice(approved) {
    if (!pendingApproval || apBusy) return;
    const { id, summary } = pendingApproval;
    resolvedIds = new Set([...resolvedIds, id]);
    apBusy = true;
    const r = await decideAndContinue(id, approved, summary);
    // The real narrated confirmation lands in the chat thread a beat later —
    // speak it too, so voice mode hears the outcome, not just sees it.
    setTimeout(() => {
      const last = get(messages).slice().reverse().find((m) => m.role === "assistant");
      if (last?.text) speakText(last.text);
      apBusy = false;
    }, 500);
    return r;
  }

  // Say "yes"/"approve" or "no"/"decline" while a card is showing — short,
  // deliberate replies only (never scan a long unrelated sentence for a stray yes/no).
  function voiceIntent(text) {
    const words = (text || "").toLowerCase().replace(/[^a-z' ]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5) return null;
    const flat = words.join(" ");
    if (words[0] === "no" || words[0] === "nope" || /\b(decline|declined|cancel|stop)\b/.test(flat) || /\bdon'?t\b/.test(flat)) return "decline";
    if (["yes", "yeah", "yep", "approve", "approved", "confirm", "sure", "ok", "okay"].includes(words[0]) || /\b(go ahead|do it|send it)\b/.test(flat)) return "approve";
    return null;
  }
  let lastCheckedLine = "";
  $: if (pendingApproval && !apBusy && lines.length) {
    const last = lines[lines.length - 1];
    if (last.who === "user" && last.text !== lastCheckedLine) {
      lastCheckedLine = last.text;
      const intent = voiceIntent(last.text);
      if (intent) decideVoice(intent === "approve");
    }
  }
</script>

<div class="veil" role="dialog" aria-label="Voice">
  <button class="x mute" class:muted on:click={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>
    <i class="ti {muted ? 'ti-microphone-off' : 'ti-microphone'}"></i>
  </button>
  <button class="x" on:click={stop} aria-label="Close"><i class="ti ti-x"></i></button>

  <div class="center">
    <Orb size={140} state={state === "connecting" ? "thinking" : (state === "error" || state === "unavailable" ? "off" : state)} {level} />
    {#if label}<div class="label" class:bad={state === "error" || state === "unavailable"}>{label}</div>{/if}

    {#if state === "error" || state === "ended"}
      <button class="retry" on:click={begin} in:fly={{ y: 6, duration: 200 }}>
        <i class="ti ti-refresh"></i> Try again
      </button>
    {/if}
    {#if needsAudioTap && state !== "error" && state !== "unavailable"}
      <button class="retry" on:click={enableAudio} in:fly={{ y: 6, duration: 200 }}>
        <i class="ti ti-volume"></i> Tap to enable sound
      </button>
    {/if}
  </div>

  {#if pendingApproval}
    <div class="apcard glass gloss" in:fly={{ y: 10, duration: 200 }}>
      <div class="ap-chip"><i class="ti ti-shield-half-filled"></i> Waiting on you</div>
      <p class="ap-summary">{pendingApproval.summary}</p>
      <div class="ap-row">
        <button class="ap-btn approve" on:click={() => decideVoice(true)} disabled={apBusy}>
          <i class="ti ti-check"></i> Approve
        </button>
        <button class="ap-btn decline" on:click={() => decideVoice(false)} disabled={apBusy}>
          <i class="ti ti-x"></i> Decline
        </button>
      </div>
      <p class="ap-hint">Tap one, or just say "yes" or "no."</p>
    </div>
  {/if}

  <div class="caps" bind:this={linesEl}>
    {#each lines as l}
      <p class="line {l.who}">{l.text}</p>
    {/each}
  </div>

  <div class="composer glass">
    <input bind:value={draft} placeholder="…or type" aria-label="Type to Emblem"
           on:keydown={(e) => e.key === "Enter" && sendDraft()} />
    <button class="send" on:click={sendDraft} aria-label="Send"><i class="ti ti-arrow-up"></i></button>
  </div>
</div>

<style>
  .veil { position: absolute; inset: 0; z-index: 50;
    background:
      radial-gradient(900px 500px at 50% 20%, var(--accent-bg), transparent 65%),
      var(--bg);
    display: flex; flex-direction: column; align-items: center; padding: 8vh 24px 28px; gap: 22px; }
  .x { position: absolute; top: 18px; right: 20px; color: var(--text-3); font-size: 20px; cursor: pointer;
    transition: color var(--t-fast); }
  .x:hover { color: var(--text); }
  .x.mute { right: 58px; }
  .x.mute.muted { color: var(--danger); }
  .center { display: flex; flex-direction: column; align-items: center; gap: 20px; padding-top: 4vh; }
  .label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
  .label.bad { color: var(--danger); }
  .retry {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 22px; border-radius: var(--r-pill);
    background: var(--accent-grad); color: var(--accent-t);
    font-size: 14px; font-weight: 500; cursor: pointer;
    box-shadow: 0 2px 12px var(--accent-glow);
    transition: filter var(--t-fast);
  }
  .retry:hover { filter: brightness(1.07); }

  .apcard { width: 100%; max-width: 420px; padding: 16px 18px;
    border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column; gap: 10px; }
  .ap-chip { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
    padding: 3px 10px; border-radius: var(--r-pill);
    background: var(--caution-bg); border: 1px solid var(--caution);
    font-size: 11.5px; font-weight: 500; color: var(--caution); }
  .ap-summary { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--text); }
  .ap-row { display: flex; gap: 8px; }
  .ap-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 9px 0; border-radius: var(--r-pill); font-size: 13.5px; font-weight: 500; cursor: pointer;
    border: 1px solid var(--border-strong); background: var(--s1); color: var(--text); }
  .ap-btn.approve:hover { border-color: var(--accent); color: var(--accent-ink); background: var(--accent-bg); }
  .ap-btn.decline:hover { border-color: var(--danger); color: var(--danger); }
  .ap-btn:disabled { opacity: 0.5; cursor: default; }
  .ap-hint { margin: 0; font-size: 11.5px; color: var(--text-3); text-align: center; }

  .caps { width: 100%; max-width: 560px; flex: 1; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px; }
  .line { margin: 0; font-size: 16px; line-height: 1.55; animation: reveal .3s ease; }
  .line.assistant { color: var(--text); }
  .line.user { color: var(--text-3); text-align: right; }
  .composer { display: flex; gap: 8px; width: 100%; max-width: 480px;
    border-radius: var(--r-pill);
    padding: 6px 6px 6px 18px;
    box-shadow: var(--shadow-md); }
  .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg), var(--shadow-md); }
  .composer input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 15px; }
  .composer input::placeholder { color: var(--text-3); }
  .send { width: 38px; height: 38px; border-radius: 50%; background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-size: 17px; cursor: pointer;
    box-shadow: 0 2px 8px var(--accent-glow); transition: filter var(--t-fast); }
  .send:hover { filter: brightness(1.07); }
</style>
