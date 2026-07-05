<script>
  // Emblem's voice mode — full-screen HANDS-FREE conversation with the breathing
  // mark. Turn-based pipeline: your words → transcription → the REAL agent loop
  // (tools, approvals, thread persistence — sendCommand) → the reply spoken back
  // → listening again, until you close it. Opened from a click (the composer
  // mic), so audio starts inside a user gesture.
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { VoiceTurnClient } from "../lib/voiceturn.js";
  import { LiveClient } from "../lib/live.js";
  import { sendCommand } from "../lib/store.js";
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
  // Debug escape hatch back to the realtime relay: localStorage emblem_voice_engine = "live".
  const useLegacy = typeof localStorage !== "undefined" && localStorage.getItem("emblem_voice_engine") === "live";
  const client = useLegacy
    ? new LiveClient({ mode: "chat", ...events })
    : new VoiceTurnClient({
        mode: "chat",
        // The brain IS the normal agent loop — messages land in the thread,
        // tools run, approval cards render in the chat behind this overlay.
        onTranscript: async (text) => {
          const r = await sendCommand(text);
          return r?.reply || null;
        },
        ...events,
      });

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
  onDestroy(() => client.stop());

  $: label = muted ? "muted — tap the mic to resume" : ({
    connecting: "waking up…",
    listening: "listening — just talk",
    thinking: "thinking…",
    speaking: "",
    unavailable: errorMsg || "voice isn't available right now",
    error: errorMsg || "couldn't connect",
    ended: "session ended",
  }[state] ?? "");
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
