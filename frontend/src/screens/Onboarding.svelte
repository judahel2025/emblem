<script>
  // Meeting Emblem — a real AI conversation, not a form.
  // The scene opens with an idle orb and two ways in:
  //   "Meet Emblem"   → the live AI speaks + listens (mic), captions run along.
  //   "prefer typing" → the SAME live AI, no mic — you type, Emblem answers with
  //                     voice + captions and still learns about you adaptively.
  // The opening tap is the user gesture that unlocks audio (browsers silence
  // sound started without one). A static three-question script exists ONLY as
  // the last resort when the connection itself fails.
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { LiveClient } from "../lib/live.js";
  import Orb from "../components/Orb.svelte";
  const dispatch = createEventDispatcher();

  let mode = "intro";           // intro | live | scripted
  let state = "idle";           // idle|connecting|listening|thinking|speaking|onboarded|unavailable|error|ended
  let withMic = true;
  let level = 0;
  let lines = [];               // {who: "user"|"assistant", text}
  let draft = "";
  let client = null;
  let linesEl;
  let errorMsg = "";
  let needsAudioTap = false;

  // ── last-resort scripted flow (no AI reachable) ─────────────────
  const QUESTIONS = [
    { q: "Hey, I'm Emblem. I'll be working alongside you — what should I call you?", key: "name" },
    { q: "Good to meet you. What do you do?", key: "role" },
    { q: "And what's the first thing you'd love a hand with?", key: "task" },
  ];
  let qi = 0;
  const answers = {};

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

  // Called from the intro taps — the gesture that makes audio audible.
  async function startLive(mic) {
    withMic = mic;
    mode = "live";
    state = "connecting";
    errorMsg = "";
    try { client?.stop(); } catch {}
    client = new LiveClient({
      mode: "onboarding",
      onState: (s) => {
        state = s;
        if (s === "onboarded") finish(true);
      },
      onCaption: ({ who, text }) => pushLine(who, text),
      onLevel: (l) => (level = l),
      onError: (m) => (errorMsg = m),
    });
    let ok = await client.start({ mic });
    // Mic blocked? The AI conversation still works — retry without the mic.
    if (!ok && mic && state === "unavailable") {
      pushLine("assistant", "(your microphone is blocked — no problem, you can type to me)");
      ok = await startLiveNoMicRetry();
    }
    needsAudioTap = client.audioSuspended();
    return ok;
  }

  async function startLiveNoMicRetry() {
    withMic = false;
    state = "connecting";
    try { client?.stop(); } catch {}
    client = new LiveClient({
      mode: "onboarding",
      onState: (s) => {
        state = s;
        if (s === "onboarded") finish(true);
      },
      onCaption: ({ who, text }) => pushLine(who, text),
      onLevel: (l) => (level = l),
      onError: (m) => (errorMsg = m),
    });
    return client.start({ mic: false });
  }

  async function enableAudio() {
    try { await client?.audioCtx?.resume(); } catch {}
    needsAudioTap = client?.audioSuspended() ?? false;
  }

  // Only when the AI can't be reached at all.
  function startScripted() {
    try { client?.stop(); } catch {}
    client = null;
    mode = "scripted";
    state = "listening";
    if (!lines.some((l) => l.who === "assistant")) pushLine("assistant", QUESTIONS[0].q);
  }

  function sendDraft() {
    const t = draft.trim();
    if (!t) return;
    draft = "";
    pushLine("user", t);
    if (mode === "live" && client) {
      client.sendText(t);
      return;
    }
    // scripted flow
    answers[QUESTIONS[qi].key] = t;
    if (qi < QUESTIONS.length - 1) {
      qi += 1;
      setTimeout(() => pushLine("assistant", QUESTIONS[qi].q), 350);
    } else {
      pushLine("assistant", `Thank you${answers.name ? ", " + answers.name : ""} — I'll remember. Let's get you set up.`);
      saveScripted();
    }
  }

  async function saveScripted() {
    state = "thinking";
    try {
      if (answers.name) await api.memoryAdd(`The user's name is ${answers.name}.`, "identity");
      if (answers.role) await api.memoryAdd(`What the user does: ${answers.role}.`, "identity");
      if (answers.task) await api.memoryAdd(`Something the user wants help with: ${answers.task}.`, "preference");
      await api.profileSet({ display_name: answers.name || "", role: answers.role || "", onboarded: true });
    } catch (e) {
      console.error("onboarding save failed:", e);
      pushLine("assistant", "Hmm — I couldn't save that just now. Give it another try in a moment.");
      state = "listening";
      qi = QUESTIONS.length - 1;
      return;
    }
    finish(false);
  }

  function finish(fromLive) {
    localStorage.setItem("emblem_onboarded", "1");
    setTimeout(() => { try { client?.stop(); } catch {}; dispatch("done"); }, fromLive ? 2600 : 900);
  }

  function skip() {
    try { client?.stop(); } catch {}
    localStorage.setItem("emblem_onboarded", "1");
    api.profileSet({ onboarded: true }).catch((e) => console.error("skip save failed:", e));
    dispatch("done");
  }

  onDestroy(() => { try { client?.stop(); } catch {} });

  $: statusLine = {
    connecting: "waking up…",
    listening: mode === "live"
      ? (withMic ? "listening — just talk (or type below)" : "type below — I'll answer out loud")
      : "type your answer below",
    thinking: "one moment…",
    speaking: "",
    onboarded: "all set.",
    error: errorMsg || "couldn't connect",
    unavailable: errorMsg || "voice isn't available right now",
    ended: "session ended",
  }[state] ?? "";
</script>

<div class="scene">
  <div class="orbwrap">
    <Orb size={120}
         state={mode === "intro" ? "idle" : state === "connecting" ? "thinking" : state === "onboarded" ? "idle" : (state === "error" || state === "unavailable") ? "off" : state}
         {level} />
  </div>

  {#if mode === "intro"}
    <div class="intro" in:fly={{ y: 12, duration: 300 }}>
      <h1>Meet Emblem.</h1>
      <p>A short hello — Emblem speaks, listens, asks about you, and remembers what matters.</p>
      <button class="meet" on:click={() => startLive(true)}>
        <i class="ti ti-microphone"></i> Meet Emblem
      </button>
      <button class="quiet" on:click={() => startLive(false)}>prefer typing? Emblem still talks</button>
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

    {#if statusLine}<div class="status" class:bad={state === "error" || state === "unavailable"}>{statusLine}</div>{/if}

    {#if needsAudioTap && state !== "error" && state !== "unavailable"}
      <button class="meet small" on:click={enableAudio} in:fly={{ y: 6, duration: 200 }}>
        <i class="ti ti-volume"></i> Tap to hear Emblem
      </button>
    {/if}

    {#if state === "error" || state === "unavailable" || state === "ended"}
      <div class="recover" in:fly={{ y: 8, duration: 200 }}>
        <button class="meet small" on:click={() => startLive(withMic)}><i class="ti ti-refresh"></i> Try again</button>
        <button class="quiet" on:click={startScripted}>continue with simple questions</button>
      </div>
    {:else}
      <div class="composer glass">
        <input
          bind:value={draft}
          aria-label="Reply to Emblem"
          placeholder={mode === "live" && withMic ? "…or type instead" : "Type your answer"}
          on:keydown={(e) => e.key === "Enter" && sendDraft()}
        />
        <button class="send" on:click={sendDraft} aria-label="Send"><i class="ti ti-arrow-up"></i></button>
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
    background: var(--accent); color: var(--accent-t);
    font-size: 16px; font-weight: 700; cursor: pointer;
    box-shadow: 0 4px 20px var(--accent-glow);
    transition: background var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .meet:hover { background: var(--accent-h); box-shadow: 0 6px 26px var(--accent-glow); transform: scale(1.02); }
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
  .send { width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-size: 17px; cursor: pointer;
    box-shadow: 0 2px 8px var(--accent-glow); transition: background var(--t-fast); }
  .send:hover { background: var(--accent-h); }
  .skip { margin-top: auto; color: var(--text-3); font-size: 13px; cursor: pointer; border-bottom: 1px solid transparent; }
  .skip:hover { color: var(--text-2); border-bottom-color: var(--divider); }
</style>
