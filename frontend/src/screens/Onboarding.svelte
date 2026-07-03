<script>
  // Meeting Emblem — a real AI conversation with NO dead ends.
  // Engine chain: live realtime voice → the SAME conversation continues on the
  // text brain (/api/onboarding/chat, three providers deep) with spoken replies
  // via one-shot TTS. The user never sees a seam and never meets a static form.
  // The opening tap is the user gesture that unlocks audio + mic.
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { LiveClient } from "../lib/live.js";
  import Orb from "../components/Orb.svelte";
  const dispatch = createEventDispatcher();

  let mode = "intro";           // intro | convo
  let engine = "none";          // none | live | chat
  let state = "idle";           // idle|connecting|listening|thinking|speaking|onboarded|error
  let withMic = true;
  let level = 0;
  let lines = [];               // {who: "user"|"assistant", text}
  let draft = "";
  let client = null;
  let linesEl;
  let errorMsg = "";
  let needsAudioTap = false;
  let chatBusy = false;
  let done = false;

  function pushLine(who, text) {
    const last = lines[lines.length - 1];
    if (last && last.who === who && who === "assistant" && state !== "listening") {
      last.text += text; lines = lines;
    } else if (last && last.who === who && who === "user") {
      last.text += text; lines = lines;
    } else {
      lines = [...lines, { who, text }];
    }
    queueMicrotask(() => { if (linesEl) linesEl.scrollTop = linesEl.scrollHeight; });
  }

  // ── Engine 1: realtime voice ─────────────────────────────────────
  async function startLive(mic) {
    withMic = mic;
    mode = "convo";
    engine = "live";
    state = "connecting";
    errorMsg = "";
    try { client?.stop(); } catch {}
    client = new LiveClient({
      mode: "onboarding",
      onState: (s) => {
        if (engine !== "live" || done) return;
        if (s === "onboarded") { state = s; finish(); return; }
        // Any terminal live state mid-conversation → carry on via the chat brain.
        if (s === "unavailable" || s === "error" || s === "ended") { fallThrough(); return; }
        state = s;
      },
      onCaption: ({ who, text }) => pushLine(who, text),
      onLevel: (l) => (level = l),
      onError: (m) => (errorMsg = m),
    });
    const ok = await client.start({ mic });
    needsAudioTap = client.audioSuspended();
    if (!ok && engine === "live" && !done) fallThrough();
  }

  // ── Engine 2: the text brain (same conversation, spoken replies) ──
  async function fallThrough() {
    try { client?.stop(); } catch {}
    client = null;
    engine = "chat";
    // If the live engine never produced a greeting, get one from the brain.
    if (!lines.some((l) => l.who === "assistant")) await chatTurn(null);
    else state = "listening";
  }

  async function chatTurn(userText) {
    if (chatBusy || done) return;
    chatBusy = true;
    state = "thinking";
    errorMsg = "";
    try {
      const history = lines.map((l) => ({ role: l.who, text: l.text }));
      if (userText) history.push({ role: "user", text: userText });
      const r = await api.onboardingChat(history);
      if (!r.ok) throw new Error(r.error || "unavailable");
      pushLine("assistant", r.reply);
      speak(r.reply);
      if (r.done) { state = "onboarded"; finish(); }
      else state = "listening";
    } catch (e) {
      console.error("onboarding chat failed:", e);
      errorMsg = "Couldn't reach Emblem.";
      state = "error";
    }
    chatBusy = false;
  }

  // Spoken replies for the chat engine — best-effort, captions always carry it.
  let audioEl = null;
  async function speak(text) {
    try {
      const url = await api.speechUrl(text);
      if (!url) return;
      try { audioEl?.pause(); } catch {}
      audioEl = new Audio(url);
      state = "speaking";
      audioEl.onended = () => { if (!done) state = "listening"; };
      await audioEl.play();
    } catch { /* audio blocked or TTS down — captions have it */ }
  }

  async function enableAudio() {
    try { await client?.audioCtx?.resume(); } catch {}
    needsAudioTap = client?.audioSuspended() ?? false;
  }

  function sendDraft() {
    const t = draft.trim();
    if (!t || done) return;
    draft = "";
    pushLine("user", t);
    if (engine === "live" && client) client.sendText(t);
    else chatTurn(t);
  }

  function retry() {
    if (engine === "chat") chatTurn(null);
    else startLive(withMic);
  }

  function finish() {
    if (done) return;
    done = true;
    localStorage.setItem("emblem_onboarded", "1");
    setTimeout(() => {
      try { client?.stop(); } catch {}
      try { audioEl?.pause(); } catch {}
      dispatch("done");
    }, 2400);
  }

  function skip() {
    try { client?.stop(); } catch {}
    try { audioEl?.pause(); } catch {}
    localStorage.setItem("emblem_onboarded", "1");
    api.profileSet({ onboarded: true }).catch((e) => console.error("skip save failed:", e));
    dispatch("done");
  }

  onDestroy(() => {
    try { client?.stop(); } catch {}
    try { audioEl?.pause(); } catch {}
  });

  $: statusLine = {
    connecting: "waking up…",
    listening: engine === "live" && withMic ? "listening — just talk (or type below)" : "type below — I'll answer out loud",
    thinking: "one moment…",
    speaking: "",
    onboarded: "all set.",
    error: errorMsg || "couldn't connect",
  }[state] ?? "";
</script>

<div class="scene">
  <div class="orbwrap">
    <Orb size={120}
         state={mode === "intro" ? "idle" : state === "connecting" ? "thinking" : state === "onboarded" ? "idle" : state === "error" ? "off" : state}
         {level} />
  </div>

  {#if mode === "intro"}
    <div class="intro" in:fly={{ y: 12, duration: 300 }}>
      <h1>Meet Emblem.</h1>
      <p>A real conversation — Emblem asks about you, listens, and remembers what matters.</p>
      <button class="meet" on:click={() => startLive(true)}>
        <i class="ti ti-microphone"></i> Meet Emblem
      </button>
      <button class="quiet" on:click={() => { mode = "convo"; fallThrough(); }}>prefer typing? Emblem still talks</button>
    </div>
  {:else}
    <div class="convo" bind:this={linesEl}>
      {#if !lines.length && state === "connecting"}
        <p class="pre">A moment — Emblem's coming to meet you.</p>
      {/if}
      {#each lines as l}
        <p class="line {l.who}">{l.text}</p>
      {/each}
    </div>

    {#if statusLine}<div class="status" class:bad={state === "error"}>{statusLine}</div>{/if}

    {#if needsAudioTap && state !== "error"}
      <button class="meet small" on:click={enableAudio} in:fly={{ y: 6, duration: 200 }}>
        <i class="ti ti-volume"></i> Tap to hear Emblem
      </button>
    {/if}

    {#if state === "error"}
      <div class="recover" in:fly={{ y: 8, duration: 200 }}>
        <button class="meet small" on:click={retry}><i class="ti ti-refresh"></i> Try again</button>
      </div>
    {:else if !done}
      <div class="composer glass">
        <input
          bind:value={draft}
          aria-label="Reply to Emblem"
          placeholder={engine === "live" && withMic ? "…or type instead" : "Type your answer"}
          disabled={chatBusy}
          on:keydown={(e) => e.key === "Enter" && sendDraft()}
        />
        <button class="send" on:click={sendDraft} aria-label="Send" disabled={chatBusy}>
          <i class="ti ti-arrow-up"></i>
        </button>
      </div>
    {/if}
  {/if}

  <button class="skip" on:click={skip}>skip for now</button>
</div>

<style>
  .scene {
    min-height: 100vh;
    display: flex; flex-direction: column; align-items: center;
    background:
      radial-gradient(900px 480px at 50% 12%, var(--accent-bg), transparent 65%),
      var(--bg);
    padding: 8vh 24px 32px;
    gap: 26px;
  }
  .orbwrap { padding: 24px 0 6px; }

  .intro { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; max-width: 460px; }
  .intro h1 { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: -0.02em; color: var(--text); }
  .intro p { margin: 0 0 10px; font-size: 15.5px; color: var(--text-2); line-height: 1.6; }
  .meet {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 14px 30px; border-radius: var(--r-pill);
    background: var(--accent-grad); color: var(--accent-t);
    font-size: 16px; font-weight: 700; cursor: pointer;
    box-shadow: 0 0 24px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .meet:hover { filter: brightness(1.04); box-shadow: 0 0 32px var(--accent-glow); transform: scale(1.02); }
  .meet.small { padding: 10px 22px; font-size: 14px; }
  .quiet { color: var(--text-3); font-size: 13.5px; cursor: pointer; border-bottom: 1px solid transparent;
    transition: color var(--t-fast); }
  .quiet:hover { color: var(--text-2); border-bottom-color: var(--divider); }
  .recover { display: flex; flex-direction: column; align-items: center; gap: 10px; }

  .convo {
    width: 100%; max-width: 560px;
    max-height: 38vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 14px;
    scroll-behavior: smooth;
  }
  .pre { color: var(--text-3); font-size: 15px; text-align: center; animation: fade-up .5s ease; }
  .line { margin: 0; font-size: 17px; line-height: 1.55; animation: reveal .35s ease; }
  .line.assistant { color: var(--text); }
  .line.user { color: var(--text-3); text-align: right; }
  .status { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
  .status.bad { color: var(--danger); }
  .composer {
    display: flex; gap: 8px; width: 100%; max-width: 480px;
    border-radius: var(--r-lg);
    padding: 6px 6px 6px 18px;
    box-shadow: var(--shadow-md);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg), var(--shadow-md); }
  .composer input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 15px; }
  .composer input::placeholder { color: var(--text-3); }
  .composer input:disabled { opacity: 0.6; }
  .send { width: 38px; height: 38px; border-radius: 50%; background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-size: 17px; cursor: pointer;
    box-shadow: 0 0 12px var(--accent-glow); transition: filter var(--t-fast); }
  .send:hover:not(:disabled) { filter: brightness(1.04); }
  .send:disabled { opacity: 0.5; cursor: default; }
  .skip { margin-top: auto; color: var(--text-3); font-size: 13px; cursor: pointer; border-bottom: 1px solid transparent; }
  .skip:hover { color: var(--text-2); border-bottom-color: var(--divider); }
</style>
