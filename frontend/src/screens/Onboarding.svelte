<script>
  // Meeting Kora — a real conversation, not a form.
  // Kora speaks first (Gemini Live under the hood, never named), listens, follows up,
  // and remembers. Type-instead is always available; if live voice can't start we fall
  // back to a quiet three-question exchange that still feels conversational.
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { LiveClient } from "../lib/live.js";
  import Orb from "../components/Orb.svelte";
  const dispatch = createEventDispatcher();

  let mode = "live";            // live | typed
  let state = "connecting";     // connecting|listening|thinking|speaking|onboarded|unavailable|ended
  let level = 0;
  let lines = [];               // {who: "user"|"assistant", text}
  let draft = "";
  let client = null;
  let linesEl;

  // ── typed fallback (quiet conversation, no Live) ────────────────
  const QUESTIONS = [
    { q: "Hey, I'm Kora. I'll be working alongside you — what should I call you?", key: "name" },
    { q: "Good to meet you. What do you do?", key: "role" },
    { q: "And what's the first thing you'd love a hand with?", key: "task" },
  ];
  let qi = 0;
  const answers = {};

  function pushLine(who, text) {
    // merge streamed caption fragments from the same speaker
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

  async function startLive() {
    client = new LiveClient({
      mode: "onboarding",
      onState: (s) => {
        state = s;
        if (s === "onboarded") finish(true);
        if (s === "unavailable") startTyped();
      },
      onCaption: ({ who, text }) => pushLine(who, text),
      onLevel: (l) => (level = l),
    });
    const ok = await client.start({ mic: true });
    if (!ok && state !== "unavailable") startTyped();
  }

  function startTyped() {
    try { client?.stop(); } catch {}
    client = null;
    mode = "typed";
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
    // typed flow
    answers[QUESTIONS[qi].key] = t;
    if (qi < QUESTIONS.length - 1) {
      qi += 1;
      setTimeout(() => pushLine("assistant", QUESTIONS[qi].q), 350);
    } else {
      pushLine("assistant", `Thank you${answers.name ? ", " + answers.name : ""} — I'll remember. Let's get you set up.`);
      saveTyped();
    }
  }

  async function saveTyped() {
    state = "thinking";
    try {
      if (answers.name) await api.memoryAdd(`The user's name is ${answers.name}.`, "identity");
      if (answers.role) await api.memoryAdd(`What the user does: ${answers.role}.`, "identity");
      if (answers.task) await api.memoryAdd(`Something the user wants help with: ${answers.task}.`, "preference");
      await api.profileSet({ display_name: answers.name || "", role: answers.role || "", onboarded: true });
    } catch {}
    finish(false);
  }

  function finish(fromLive) {
    localStorage.setItem("veyra_onboarded", "1");
    setTimeout(() => { try { client?.stop(); } catch {}; dispatch("done"); }, fromLive ? 2600 : 900);
  }

  function skip() {
    try { client?.stop(); } catch {}
    localStorage.setItem("veyra_onboarded", "1");
    dispatch("done");
  }

  onMount(startLive);
  onDestroy(() => { try { client?.stop(); } catch {} });

  $: statusLine = {
    connecting: "waking up…",
    listening: mode === "live" ? "listening — just talk" : "type your answer below",
    thinking: "one moment…",
    speaking: "",
    onboarded: "all set.",
    ended: "session ended",
  }[state] ?? "";
</script>

<div class="scene">
  <div class="orbwrap">
    <Orb size={120} state={state === "connecting" ? "thinking" : state === "onboarded" ? "idle" : state} {level} />
  </div>

  <div class="convo" bind:this={linesEl}>
    {#if !lines.length}
      <p class="pre">A moment — Kora's coming to meet you.</p>
    {/if}
    {#each lines as l}
      <p class="line {l.who}">{l.text}</p>
    {/each}
  </div>

  {#if statusLine}<div class="status">{statusLine}</div>{/if}

  <div class="composer">
    <input
      bind:value={draft}
      placeholder={mode === "live" ? "…or type instead" : "Type your answer"}
      on:keydown={(e) => e.key === "Enter" && sendDraft()}
    />
    <button class="send" on:click={sendDraft} aria-label="Send"><i class="ti ti-arrow-up"></i></button>
  </div>

  <button class="skip" on:click={skip}>skip for now</button>
</div>

<style>
  .scene {
    min-height: 100vh;
    display: flex; flex-direction: column; align-items: center;
    background: var(--bg);
    padding: 8vh 24px 32px;
    gap: 26px;
  }
  .orbwrap { padding: 24px 0 6px; }
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
  .composer {
    display: flex; gap: 8px; width: 100%; max-width: 480px;
    border: 1px solid var(--border); border-radius: var(--r-pill);
    padding: 6px 6px 6px 18px; background: var(--s1);
    transition: border-color var(--t-normal) ease;
  }
  .composer:focus-within { border-color: var(--border-strong); }
  .composer input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 15px; }
  .composer input::placeholder { color: var(--text-3); }
  .send { width: 38px; height: 38px; border-radius: 50%; background: var(--s4); color: var(--text);
    display: grid; place-items: center; font-size: 17px; }
  .skip { margin-top: auto; color: var(--text-3); font-size: 13px; border-bottom: 1px solid transparent; }
  .skip:hover { color: var(--text-2); border-bottom-color: var(--divider); }
</style>
