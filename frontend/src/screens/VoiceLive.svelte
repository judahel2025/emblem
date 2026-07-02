<script>
  // Emblem's voice mode — full-screen conversation with the breathing mark.
  import { createEventDispatcher, onDestroy } from "svelte";
  import { LiveClient } from "../lib/live.js";
  import Orb from "../components/Orb.svelte";
  const dispatch = createEventDispatcher();

  let state = "connecting";
  let level = 0;
  let lines = [];
  let draft = "";
  let linesEl;

  function pushLine(who, text) {
    const last = lines[lines.length - 1];
    if (last && last.who === who) { last.text += text; lines = lines; }
    else lines = [...lines, { who, text }];
    if (lines.length > 8) lines = lines.slice(-8);
    queueMicrotask(() => { if (linesEl) linesEl.scrollTop = linesEl.scrollHeight; });
  }

  const client = new LiveClient({
    mode: "chat",
    onState: (s) => (state = s),
    onCaption: ({ who, text }) => pushLine(who, text),
    onLevel: (l) => (level = l),
  });
  client.start({ mic: true });

  function sendDraft() {
    const t = draft.trim(); if (!t) return;
    draft = ""; pushLine("user", t); client.sendText(t);
  }

  function stop() { client.stop(); dispatch("close"); }
  onDestroy(() => client.stop());

  $: label = {
    connecting: "waking up…",
    listening: "listening — just talk",
    thinking: "thinking…",
    speaking: "",
    unavailable: "voice isn't available right now",
    ended: "session ended",
  }[state] ?? "";
</script>

<div class="veil" role="dialog" aria-label="Voice">
  <button class="x" on:click={stop} aria-label="Close"><i class="ti ti-x"></i></button>

  <div class="center">
    <Orb size={140} state={state === "connecting" ? "thinking" : state} {level} />
    {#if label}<div class="label">{label}</div>{/if}
  </div>

  <div class="caps" bind:this={linesEl}>
    {#each lines as l}
      <p class="line {l.who}">{l.text}</p>
    {/each}
  </div>

  <div class="composer">
    <input bind:value={draft} placeholder="…or type"
           on:keydown={(e) => e.key === "Enter" && sendDraft()} />
    <button class="send" on:click={sendDraft} aria-label="Send"><i class="ti ti-arrow-up"></i></button>
  </div>
</div>

<style>
  .veil { position: absolute; inset: 0; background: var(--bg); z-index: 50;
    display: flex; flex-direction: column; align-items: center; padding: 8vh 24px 28px; gap: 22px; }
  .x { position: absolute; top: 18px; right: 20px; color: var(--text-3); font-size: 20px; }
  .x:hover { color: var(--text); }
  .center { display: flex; flex-direction: column; align-items: center; gap: 20px; padding-top: 4vh; }
  .label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
  .caps { width: 100%; max-width: 540px; flex: 1; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px; }
  .line { margin: 0; font-size: 16px; line-height: 1.55; animation: reveal .3s ease; }
  .line.assistant { color: var(--text); }
  .line.user { color: var(--text-3); text-align: right; }
  .composer { display: flex; gap: 8px; width: 100%; max-width: 460px;
    border: 1px solid var(--border); border-radius: var(--r-pill);
    padding: 6px 6px 6px 18px; background: var(--s1); }
  .composer:focus-within { border-color: var(--border-strong); }
  .composer input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 15px; }
  .composer input::placeholder { color: var(--text-3); }
  .send { width: 38px; height: 38px; border-radius: 50%; background: var(--s4); color: var(--text);
    display: grid; place-items: center; font-size: 17px; }
</style>
