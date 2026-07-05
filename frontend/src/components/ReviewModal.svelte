<script>
  // The review flow — two paths, user's choice: talk it through with Emblem
  // (AI confirms each complaint, then logs a structured review) or just write
  // it. Both land in the admin console.
  import { createEventDispatcher, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { notify } from "../lib/store.js";
  const dispatch = createEventDispatcher();
  const close = () => dispatch("close");

  let step = "choice";        // choice | ai | typed | done
  let lines = [];             // {who, text}
  let draft = "";
  let busy = false;
  let typedText = "";
  let linesEl, inputEl;

  async function refocus() { await tick(); try { inputEl?.focus(); } catch {} }
  function focusNow(node) { try { node.focus(); } catch {} }

  async function startAI() {
    step = "ai";
    await chatTurn(null);
  }

  async function chatTurn(userText) {
    if (busy) return;
    busy = true;
    try {
      const history = lines.map((l) => ({ role: l.who, text: l.text }));
      if (userText) history.push({ role: "user", text: userText });
      const r = await api.reviewChat(history);
      if (!r.ok) throw new Error(r.error || "unavailable");
      lines = [...lines, { who: "assistant", text: r.reply }];
      queueMicrotask(() => { if (linesEl) linesEl.scrollTop = linesEl.scrollHeight; });
      if (r.done) {
        step = "done";
        setTimeout(close, 2600);
      }
    } catch (e) {
      console.error("review chat failed:", e);
      notify("Couldn't reach Emblem — try again in a moment.", "danger");
    }
    busy = false;
    refocus();
  }

  function send() {
    const t = draft.trim();
    if (!t || busy) return;
    draft = "";
    lines = [...lines, { who: "user", text: t }];
    queueMicrotask(() => { if (linesEl) linesEl.scrollTop = linesEl.scrollHeight; });
    chatTurn(t);
  }

  async function submitTyped() {
    const t = typedText.trim();
    if (!t || busy) return;
    busy = true;
    try {
      const r = await api.reviewSubmit(t);
      if (!r.ok) throw new Error(r.error || "failed");
      notify("Thanks — your review went straight to the team.", "safe");
      close();
    } catch (e) {
      console.error("review submit failed:", e);
      notify("Couldn't save your review — try again.", "danger");
    }
    busy = false;
  }
</script>

<div class="veil" on:click|self={close} transition:fade={{ duration: 150 }} role="presentation">
  <div class="panel glass gloss" transition:fly={{ y: 14, duration: 220 }}
       role="dialog" aria-label="Leave a review">
    <div class="head">
      <h3><i class="ti ti-message-star"></i> Your review</h3>
      <button class="x" on:click={close} aria-label="Close"><i class="ti ti-x"></i></button>
    </div>

    {#if step === "choice"}
      <p class="sub">However you'd rather do it — it all reaches the team.</p>
      <div class="paths stagger">
        <button class="path" on:click={startAI}>
          <i class="ti ti-sparkles"></i>
          <b>Talk it through with Emblem</b>
          <span>It asks a few questions to make sure every point lands clearly.</span>
        </button>
        <button class="path" on:click={() => (step = "typed")}>
          <i class="ti ti-pencil"></i>
          <b>Just write it</b>
          <span>Type your review in your own words and send it off.</span>
        </button>
      </div>

    {:else if step === "ai"}
      <div class="convo" bind:this={linesEl}>
        {#if !lines.length}<p class="pre">One moment…</p>{/if}
        {#each lines as l}
          <p class="line {l.who}">{l.text}</p>
        {/each}
        {#if busy}<p class="line assistant dots"><span></span><span></span><span></span></p>{/if}
      </div>
      <div class="composer">
        <input bind:value={draft} bind:this={inputEl} use:focusNow
               placeholder="Type your answer"
               aria-label="Reply to Emblem"
               on:keydown={(e) => e.key === "Enter" && send()} />
        <button class="send" on:click={send} disabled={busy} aria-label="Send">
          <i class="ti ti-arrow-up"></i>
        </button>
      </div>

    {:else if step === "typed"}
      <textarea rows="7" bind:value={typedText} use:focusNow
                placeholder="What's working? What's been frustrating? Anything goes…"></textarea>
      <div class="row">
        <button class="ghostb" on:click={() => (step = "choice")}>
          <i class="ti ti-arrow-left"></i> Back
        </button>
        <button class="primaryb" on:click={submitTyped} disabled={busy || !typedText.trim()}>
          {busy ? "Sending…" : "Send review"}
        </button>
      </div>

    {:else}
      <div class="thanks" in:fade={{ duration: 200 }}>
        <i class="ti ti-circle-check"></i>
        <p>Thank you — your feedback went straight to the team.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .veil {
    position: fixed; inset: 0; z-index: 120;
    background: rgba(0, 0, 0, 0.5);
    -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    display: grid; place-items: center; padding: 20px;
  }
  .panel {
    width: min(520px, 100%);
    border-radius: var(--r-seal); padding: 20px 22px;
    box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column; gap: 14px;
    max-height: min(640px, 90vh);
  }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .head h3 { margin: 0; font-size: 17px; font-weight: 500; color: var(--text);
    display: inline-flex; align-items: center; gap: 8px; }
  .x { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
    color: var(--text-3); font-size: 17px; cursor: pointer; }
  .x:hover { color: var(--text); background: var(--accent-bg); }
  .sub { margin: 0; font-size: 14px; color: var(--text-2); }

  .paths { display: flex; flex-direction: column; gap: 10px; }
  .path {
    display: flex; flex-direction: column; gap: 4px; text-align: left;
    padding: 16px 18px; border-radius: var(--r-md);
    border: 1px solid var(--border); background: var(--s1);
    cursor: pointer; transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .path:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); transform: translateY(-1px); }
  .path i { font-size: 20px; color: var(--accent-ink); }
  .path b { font-size: 15px; color: var(--text); }
  .path span { font-size: 13px; color: var(--text-2); line-height: 1.5; }

  .convo { flex: 1; min-height: 180px; max-height: 320px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth; }
  .pre { color: var(--text-3); font-size: 14px; }
  .line { margin: 0; font-size: 15px; line-height: 1.55; animation: fade-up 0.3s ease; }
  .line.assistant { color: var(--text); font-family: var(--font-voice); font-style: italic; font-size: 16px; }
  .line.user { color: var(--text-3); text-align: right; }
  .line.dots { display: flex; gap: 4px; }
  .line.dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3);
    animation: dot-bounce 1.2s ease-in-out infinite; }
  .line.dots span:nth-child(2) { animation-delay: 0.15s; }
  .line.dots span:nth-child(3) { animation-delay: 0.3s; }

  .composer { display: flex; gap: 8px; border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 5px 5px 5px 14px; background: var(--s1); }
  .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .composer input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 14.5px; }
  .send { width: 34px; height: 34px; border-radius: 50%; background: var(--accent-grad);
    color: var(--accent-t); display: grid; place-items: center; font-size: 15px; cursor: pointer; }
  .send:disabled { opacity: 0.5; cursor: default; }

  textarea {
    background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 13px 15px; color: var(--text); font-size: 14.5px; resize: vertical; min-height: 130px;
  }
  textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); outline: none; }
  .row { display: flex; align-items: center; justify-content: space-between; }
  .ghostb { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3);
    font-size: 14px; cursor: pointer; }
  .ghostb:hover { color: var(--text); }
  .primaryb { padding: 10px 22px; border-radius: var(--r-pill); background: var(--accent-grad);
    color: var(--accent-t); font-size: 14px; font-weight: 500; cursor: pointer;
    box-shadow: 0 0 14px var(--accent-glow); }
  .primaryb:disabled { opacity: 0.5; cursor: default; box-shadow: none; }

  .thanks { display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 26px 0 14px; text-align: center; }
  .thanks i { font-size: 34px; color: var(--safe); }
  .thanks p { margin: 0; font-size: 15px; color: var(--text); }
</style>
