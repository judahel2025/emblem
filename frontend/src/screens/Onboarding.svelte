<script>
  // Meeting Emblem — a real AI conversation with NO dead ends, or a classic
  // form: the member picks, and can SWITCH either way mid-flight without
  // losing progress (AI → form pre-fills via the extractor; form → AI hands
  // the answers to the conversation). A progress bar always shows how far
  // along they are, and everything persists across a refresh.
  // Engine chain in AI mode: live realtime voice → the SAME conversation
  // continues on the text brain with spoken replies via one-shot TTS.
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { LiveClient } from "../lib/live.js";
  import Orb from "../components/Orb.svelte";
  const dispatch = createEventDispatcher();

  let mode = "intro";           // intro | convo | form
  let engine = "none";          // none | live | chat
  let state = "idle";           // idle|connecting|listening|thinking|speaking|onboarded|error
  let withMic = true;
  let level = 0;
  let lines = [];               // {who: "user"|"assistant", text}
  let draft = "";
  let client = null;
  let linesEl;
  let inputEl;
  let errorMsg = "";
  let needsAudioTap = false;
  let chatBusy = false;
  let done = false;
  let switching = false;        // AI → form extraction in flight

  // ── The classic form — extractor-shaped fields, one step at a time ──
  const FIELDS = [
    { key: "display_name", label: "What should Emblem call you?", ph: "Your name", required: true },
    { key: "role", label: "What do you do?", ph: "e.g. I run a small design studio" },
    { key: "current_work", label: "What are you working on right now?", ph: "The project or push that has your attention", area: true },
    { key: "focus", label: "What would you most like to hand over to an assistant?", ph: "The thing you'd happily never do again", area: true },
    { key: "tools", label: "Which apps and tools do you live in?", ph: "Gmail, Notion, GitHub… (comma-separated)" },
    { key: "tone", label: "How should Emblem talk to you?", ph: "e.g. brief and direct · warm and chatty" },
    { key: "quiet_hours", label: "When should Emblem NOT disturb you?", ph: "e.g. 22:00–07:00, or weekends" },
    { key: "boundaries", label: "Anything Emblem should never do for you?", ph: "e.g. never send email without asking" },
  ];
  let form = Object.fromEntries(FIELDS.map((f) => [f.key, ""]));
  let formStep = 0;
  let formBusy = false;

  // ── Progress — one bar, both modes. AI counts questions asked; the form
  //    counts steps. The wrap-up checkpoint lands around question 10. ──
  $: asked = lines.filter((l) => l.who === "assistant").length;
  $: progress = done ? 1
    : mode === "form" ? (formStep + (form[FIELDS[formStep]?.key] ? 1 : 0)) / FIELDS.length
    : mode === "convo" ? Math.min(asked / 12, 0.95)
    : 0;

  // ── Persistence — a refresh never loses the member's progress. ──
  const DRAFT_KEY = "emblem_onboard_state";
  function persist() {
    if (done) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode, lines, form, formStep }));
    } catch {}
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }
  $: if (mode !== "intro") { void lines; void form; void formStep; persist(); }
  // Restore: a saved draft skips the intro and resumes exactly where they were.
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (saved && (saved.lines?.length || Object.values(saved.form || {}).some(Boolean))) {
      lines = saved.lines || [];
      form = { ...form, ...(saved.form || {}) };
      formStep = Math.min(saved.formStep || 0, FIELDS.length - 1);
      if (saved.mode === "form") { mode = "form"; }
      else if (saved.mode === "convo" && lines.length) {
        mode = "convo"; engine = "chat"; state = "listening";
      }
    }
  } catch {}

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

  // Keep the reply box focused so the member can just keep typing —
  // losing the caret after every answer was a real Judah complaint.
  async function refocus() { await tick(); try { inputEl?.focus(); } catch {} }
  function focusNow(node) { try { node.focus(); } catch {} }

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
    refocus();
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
    refocus();
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
    if (!t || done || chatBusy) return;
    draft = "";
    pushLine("user", t);
    if (engine === "live" && client) client.sendText(t);
    else chatTurn(t);
    refocus();
  }

  function retry() {
    if (engine === "chat") chatTurn(null);
    else startLive(withMic);
  }

  // ── The switch: AI → form (pre-filled) and form → AI (context handed over) ──
  async function switchToForm() {
    if (switching) return;
    switching = true;
    try { client?.stop(); } catch {}
    try { audioEl?.pause(); } catch {}
    client = null;
    // Pull what the conversation already learned so nothing is re-asked.
    if (lines.some((l) => l.who === "user")) {
      try {
        const r = await api.onboardingExtract(lines.map((l) => ({ role: l.who, text: l.text })));
        const f = r?.fields || {};
        for (const { key } of FIELDS) {
          const v = key === "tools"
            ? (Array.isArray(f.tools) ? f.tools.filter(Boolean).join(", ") : f.tools)
            : f[key];
          if (typeof v === "string" && v.trim() && v !== "null" && !form[key]) form[key] = v.trim();
        }
        form = form;
      } catch (e) { console.error("extract for form failed:", e); }
    }
    // Land on the first empty field so they continue, not restart.
    const firstEmpty = FIELDS.findIndex((f) => !form[f.key]);
    formStep = firstEmpty === -1 ? FIELDS.length - 1 : firstEmpty;
    mode = "form";
    engine = "none";
    state = "idle";
    switching = false;
  }

  function switchToAI() {
    // Hand the form's answers to the conversation so the AI never re-asks.
    const filled = FIELDS.filter((f) => form[f.key]?.trim());
    if (filled.length) {
      const summary = filled.map((f) => `${f.label} ${form[f.key].trim()}`).join(" · ");
      const note = `(I already filled part of a form — here's what I said, don't re-ask these: ${summary})`;
      const last = lines[lines.length - 1];
      if (!last || last.who !== "user" || !last.text.startsWith("(I already filled")) {
        lines = [...lines, { who: "user", text: note }];
      }
    }
    mode = "convo";
    engine = "chat";
    chatTurn(null);
  }

  // ── Form navigation + completion ──
  function formNext() {
    if (FIELDS[formStep].required && !form[FIELDS[formStep].key].trim()) return;
    if (formStep < FIELDS.length - 1) formStep += 1;
    else submitForm();
  }
  function formBack() { if (formStep > 0) formStep -= 1; }
  async function submitForm() {
    if (formBusy || done) return;
    formBusy = true;
    errorMsg = "";
    try {
      const fields = {
        ...form,
        tools: form.tools ? form.tools.split(",").map((s) => s.trim()).filter(Boolean) : null,
        comm_style: form.tone || null,
      };
      const r = await api.onboardingForm(fields);
      if (!r.ok) throw new Error("save failed");
      state = "onboarded";
      finish();
    } catch (e) {
      console.error("onboarding form failed:", e);
      errorMsg = "Couldn't save — try again.";
    }
    formBusy = false;
  }

  function finish() {
    if (done) return;
    done = true;
    clearDraft();
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
    clearDraft();
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
  {#if mode !== "intro"}
    <div class="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}
         aria-valuemin="0" aria-valuemax="100" aria-label="Onboarding progress">
      <div class="fill" style={`width: ${Math.max(progress * 100, 3)}%`}></div>
    </div>
  {/if}

  <div class="orbwrap">
    <Orb size={mode === "form" ? 84 : 120}
         state={mode === "intro" || mode === "form" ? "idle" : state === "connecting" ? "thinking" : state === "onboarded" ? "idle" : state === "error" ? "off" : state}
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
      <button class="quiet" on:click={() => { mode = "form"; }}>or fill a quick form instead</button>
    </div>

  {:else if mode === "form"}
    <div class="formwrap" in:fly={{ y: 12, duration: 250 }}>
      <div class="fcount">{formStep + 1} of {FIELDS.length}</div>
      {#key formStep}
        <div class="fstep" in:fly={{ x: 24, duration: 220 }}>
          <label class="flabel" for="ob-field">{FIELDS[formStep].label}</label>
          {#if FIELDS[formStep].area}
            <textarea id="ob-field" rows="3" use:focusNow
                      bind:value={form[FIELDS[formStep].key]}
                      placeholder={FIELDS[formStep].ph}
                      on:keydown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); formNext(); } }}></textarea>
          {:else}
            <input id="ob-field" use:focusNow
                   bind:value={form[FIELDS[formStep].key]}
                   placeholder={FIELDS[formStep].ph}
                   on:keydown={(e) => e.key === "Enter" && formNext()} />
          {/if}
        </div>
      {/key}
      <div class="fnav">
        <button class="fback" on:click={formBack} disabled={formStep === 0}>
          <i class="ti ti-arrow-left"></i> Back
        </button>
        <button class="meet small" on:click={formNext}
                disabled={formBusy || (FIELDS[formStep].required && !form[FIELDS[formStep].key].trim())}>
          {#if formBusy}Saving…{:else if formStep === FIELDS.length - 1}Finish <i class="ti ti-check"></i>{:else}Next <i class="ti ti-arrow-right"></i>{/if}
        </button>
      </div>
      {#if errorMsg}<div class="status bad">{errorMsg}</div>{/if}
      {#if !done}
        <button class="switchlink" on:click={switchToAI}>
          <i class="ti ti-sparkles"></i> Switch to the AI conversation — your answers carry over
        </button>
      {/if}
      {#if done}
        <div class="alldone" in:fade={{ duration: 200 }}><i class="ti ti-circle-check"></i> All set — welcome in.</div>
      {/if}
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
          bind:this={inputEl}
          use:focusNow
          aria-label="Reply to Emblem"
          placeholder={engine === "live" && withMic ? "…or type instead" : "Type your answer"}
          on:keydown={(e) => e.key === "Enter" && sendDraft()}
        />
        <button class="send" on:click={sendDraft} aria-label="Send" disabled={chatBusy}>
          {#if chatBusy}<span class="spin-dot"></span>{:else}<i class="ti ti-arrow-up"></i>{/if}
        </button>
      </div>
      <button class="switchlink" on:click={switchToForm} disabled={switching}>
        {#if switching}<span class="spin-dot dark"></span> carrying your answers over…
        {:else}<i class="ti ti-forms"></i> Prefer a quick form? Switch — nothing is lost{/if}
      </button>
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
    position: relative;
  }

  /* ── The progress bar — always visible once the journey starts ── */
  .progress {
    position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: var(--accent-bg);
  }
  .progress .fill {
    height: 100%;
    background: var(--accent-grad);
    box-shadow: 0 0 12px var(--accent-glow);
    border-radius: 0 99px 99px 0;
    transition: width 0.5s var(--spring);
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
  .meet:disabled { opacity: 0.5; cursor: default; }
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
  .send { width: 38px; height: 38px; border-radius: 50%; background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-size: 17px; cursor: pointer;
    box-shadow: 0 0 12px var(--accent-glow); transition: filter var(--t-fast); }
  .send:hover:not(:disabled) { filter: brightness(1.04); }
  .send:disabled { opacity: 0.5; cursor: default; }

  /* ── The classic form — one calm question at a time ── */
  .formwrap {
    width: 100%; max-width: 480px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .fcount { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); text-align: center; }
  .fstep { display: flex; flex-direction: column; gap: 10px; }
  .flabel { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); }
  .fstep input, .fstep textarea {
    background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 13px 16px; color: var(--text); font-size: 15px; resize: none;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .fstep input:focus, .fstep textarea:focus {
    border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); outline: none;
  }
  .fnav { display: flex; align-items: center; justify-content: space-between; }
  .fback { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 14px;
    cursor: pointer; transition: color var(--t-fast); }
  .fback:hover:not(:disabled) { color: var(--text); }
  .fback:disabled { opacity: 0.3; cursor: default; }
  .alldone { display: flex; align-items: center; gap: 8px; justify-content: center;
    color: var(--safe); font-size: 15px; font-weight: 600; }

  .switchlink {
    display: inline-flex; align-items: center; gap: 7px; align-self: center;
    color: var(--text-3); font-size: 13px; cursor: pointer;
    border-bottom: 1px solid transparent; transition: color var(--t-fast);
  }
  .switchlink:hover { color: var(--accent-ink); border-bottom-color: var(--divider); }
  .switchlink:disabled { opacity: 0.6; cursor: default; }

  .spin-dot {
    width: 13px; height: 13px; border-radius: 50%;
    border: 2px solid rgba(0,0,0,0.25); border-top-color: var(--accent-t);
    animation: spin 0.7s linear infinite; display: inline-block;
  }
  .spin-dot.dark { border-color: var(--border-strong); border-top-color: var(--accent); }

  .skip { margin-top: auto; color: var(--text-3); font-size: 13px; cursor: pointer; border-bottom: 1px solid transparent; }
  .skip:hover { color: var(--text-2); border-bottom-color: var(--divider); }
</style>
