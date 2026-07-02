<script>
  import { tick } from "svelte";
  import { marked } from "marked";
  import { messages, thinking, voiceState, voiceLive, pendingCount, brainReady, briefing, approvals, decide, sendCommand, sendAttachment, stopSpeaking, speakText, voiceCfg, notify, me } from "../lib/store.js";
  import { api } from "../lib/api.js";
  import { VoiceSession } from "../lib/voice.js";
  import WaveformBar from "./WaveformBar.svelte";
  import Orb from "./Orb.svelte";

  marked.setOptions({ gfm: true, breaks: true });
  function render(text) {
    try { return marked.parse(String(text || "")); } catch { return String(text || ""); }
  }

  // ── Input state ────────────────────────────────────────────────
  let text = "";
  let fileInput;
  let uploading = false;
  let session = null;
  let micStream = null;
  let diag = "";

  // ── Auto-scroll ────────────────────────────────────────────────
  let threadEl;
  $: if ($messages.length || $thinking) scrollBottom();
  async function scrollBottom() {
    await tick();
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  }

  // ── Copy ───────────────────────────────────────────────────────
  let copiedIdx = null;
  async function copy(t, i) {
    try { await navigator.clipboard.writeText(t); } catch {
      const el = document.createElement("textarea");
      el.value = t; el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
    }
    copiedIdx = i;
    setTimeout(() => copiedIdx = null, 1800);
  }

  // ── Voice ──────────────────────────────────────────────────────
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  let wake = false, wakeRec = null;
  const WAKE = /\b(hey )?ko+ra\b|\bcora\b/i;
  const APPROVE = /\b(approve|approved|accept|confirm|go ahead|do it|yes do)\b/i;
  const REJECT = /\b(reject|deny|cancel|don'?t do)\b/i;
  const STOP = /^\s*(stop|stop talking|be quiet|quiet|shush|shut up|hush|enough|wait|hold on|never ?mind)\s*[.!]?\s*$/i;

  let cfg = { engine: "piper", voice: "en_US-libritts-high:0", rate: "+0%" };
  api.voiceConfig().then(c => { cfg = { ...cfg, ...c }; voiceCfg.set(cfg); }).catch(() => {});

  async function process(t) {
    stopSpeaking();
    if (STOP.test(t)) return "";
    const pend = $approvals.pending || [];
    if (pend.length && APPROVE.test(t)) { await decide(pend[0].id, true); return `Approved.`; }
    if (pend.length && REJECT.test(t)) { await decide(pend[0].id, false); return `Rejected.`; }
    const r = await sendCommand(t);
    return r?.reply || "";
  }

  async function onUtterance(blob) {
    const r = await api.sttBlob(blob).catch(() => ({ text: "" }));
    const heard = (r.text || "").trim();
    if (!heard) { diag = "(didn't catch that)"; return null; }
    diag = `"${heard}"`;
    const reply = await process(heard);
    if (!reply) return null;
    try { return await api.ttsUrl(reply, cfg.voice, cfg.rate, cfg.engine); } catch { return null; }
  }

  function setPhase(p) { voiceState.set(p); }

  async function goLive() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      session = new VoiceSession({ onState: setPhase, onDiag: d => diag = d, onUtterance });
      await session.start();
      voiceLive.set(true);
    } catch (e) {
      session = null; micStream = null;
      notify(e.name === "NotAllowedError" ? "Microphone blocked." : `Mic error: ${e.name}`, "danger");
      setPhase("idle");
    }
  }

  function stopLive() {
    session?.stop(); session = null;
    micStream?.getTracks().forEach(t => t.stop()); micStream = null;
    voiceLive.set(false); setPhase("idle"); diag = "";
  }

  function toggleLive() { $voiceLive ? stopLive() : goLive(); }

  function toggleWake() {
    wake = !wake;
    if (wake) {
      if (!SR) { notify("Wake word needs Chrome/Edge.", "caution"); wake = false; return; }
      wakeRec = new SR(); wakeRec.continuous = true; wakeRec.interimResults = false;
      wakeRec.onresult = e => {
        const t = Array.from(e.results).map(r => r[0].transcript).join(" ");
        if (WAKE.test(t) && !$voiceLive) goLive();
      };
      wakeRec.onend = () => { if (wake && !$voiceLive) try { wakeRec.start(); } catch {} };
      try { wakeRec.start(); } catch {}
    } else {
      try { wakeRec?.stop(); } catch {} wakeRec = null;
    }
  }

  // ── Submit typed ───────────────────────────────────────────────
  async function submit() {
    const v = text.trim(); if (!v || $thinking) return;
    text = "";
    const reply = await process(v);
    if (reply) speakText(reply, cfg);
  }

  // sendText helper used by chips
  async function sendText(t) {
    if ($thinking) return;
    text = t;
    await submit();
  }

  function handleInput(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }

  // ── File upload ────────────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    fileInput.value = "";
    uploading = true;
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    notify(`Reading ${file.name}…`, "safe");
    try {
      const r = await api.analyzeUpload(file);
      if (!r.ok) { notify(`Couldn't read ${file.name}`, "danger"); uploading = false; return; }
      await sendAttachment(file.name, file.type, r.reply, preview);
    } catch (err) { notify(`Upload failed: ${err?.message}`, "danger"); }
    uploading = false;
  }

  const stateLabel = { idle: "", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" };
</script>

<div class="chat">
  <!-- Thread -->
  <div class="thread" bind:this={threadEl}>
    {#if $messages.length === 0 && !$thinking}
      <!-- Empty state — one question, one composer, nothing else (ChatGPT anatomy) -->
      <div class="empty">
        <Orb size={54} state="idle" />
        <p class="empty-title">{$me.display_name ? `What are we doing today, ${$me.display_name}?` : "What are you working on?"}</p>
        <div class="chips">
          <button class="chip" on:click={() => sendText("What's on my calendar today?")}>Today's calendar</button>
          <button class="chip" on:click={() => sendText("Summarize my unread email")}>Unread email</button>
          <button class="chip" on:click={() => sendText("Start a page for a new idea")}>New page</button>
          <button class="chip" on:click={() => sendText("Set up a morning briefing")}>Daily automation</button>
        </div>
      </div>
    {:else}
      {#each $messages as msg, i}
        {#if msg.role === "user"}
          <div class="row user">
            <div class="user-pill">
              {#if msg.imagePreview}<img src={msg.imagePreview} alt="attachment" class="attach-img"/>{/if}
              {#if msg.isAttachment}
                <span class="attach-label"><i class="ti ti-paperclip"></i> {msg.attachmentName}</span>
              {:else}
                {msg.text}
              {/if}
            </div>
          </div>
        {:else}
          <div class="row assistant">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="md-body" on:click={() => copy(msg.text, i)}>{@html render(msg.text)}
              {#if copiedIdx === i}<span class="copied-badge">Copied</span>{/if}
            </div>
          </div>
        {/if}
      {/each}

      {#if $thinking}
        <div class="row assistant thinking-row">
          <Orb size={16} state="thinking" />
        </div>
      {/if}
    {/if}
  </div>

  <!-- Pending approvals inline -->
  {#if ($approvals.pending || []).length > 0}
    <div class="approvals-bar">
      {#each $approvals.pending.slice(0,3) as ap}
        <div class="approval-card">
          <div class="ap-info">
            <span class="ap-tool">{ap.tool}</span>
            <span class="ap-summary">{ap.summary}</span>
          </div>
          <div class="ap-btns">
            <button class="ap-btn approve" on:click={() => decide(ap.id, true)}>Approve</button>
            <button class="ap-btn reject" on:click={() => decide(ap.id, false)}>Reject</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Input pill -->
  <div class="input-area">
    <div class="pill" class:listening={$voiceState === 'listening'}>
      <!-- Mic / waveform -->
      {#if $voiceLive}
        <button class="circle-btn mic-btn active" on:click={stopLive} title="Stop listening">
          <WaveformBar state={$voiceState} stream={micStream} size="sm" />
        </button>
      {:else}
        <button class="circle-btn mic-btn" on:click={goLive} title="Voice input">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="4" y="1" width="6" height="8" rx="3" stroke="currentColor" stroke-width="1.4"/>
            <path d="M2 7a5 5 0 0010 0M7 12v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      {/if}

      <textarea
        bind:value={text}
        on:keydown={handleInput}
        placeholder={$voiceState === 'listening' ? 'Listening…' : 'Ask anything'}
        rows="1"
        class="msg-input"
        disabled={$thinking}
      ></textarea>

      <!-- Attach -->
      <button class="circle-btn ghost" on:click={() => fileInput.click()} title="Attach file" disabled={uploading || $thinking}>
        {#if uploading}
          <span class="spin-sm"></span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 6.5L6.5 12A4.5 4.5 0 011 6.5l5-5a3 3 0 014.24 4.24L5.5 10.5A1.5 1.5 0 113.38 8.38L8 3.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {/if}
      </button>
      <input bind:this={fileInput} type="file" accept="image/*,.pdf,.txt,.docx,.pptx,.xlsx,.doc,.md,.csv,.json,.py,.js,.ts,.html,.css,.sql" style="display:none" on:change={handleFile} />

      <!-- Send -->
      <button class="circle-btn send-btn" on:click={submit} disabled={!text.trim() || $thinking} title="Send">
        {#if $thinking}
          <span class="spin-sm white"></span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 11V3M3.5 6.5L7 3l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {/if}
      </button>
    </div>
    {#if diag}<p class="diag">{diag}</p>{/if}
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--bg); }

  /* Thread */
  .thread {
    flex: 1; overflow-y: auto; padding: 20px 16px 8px;
    display: flex; flex-direction: column; gap: 6px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }

  /* Center content */
  .thread > * { max-width: 680px; width: 100%; margin: 0 auto; }

  /* Empty state — quiet, centered, one question */
  .empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    flex: 1; gap: 22px; padding: 60px 20px; text-align: center;
    min-height: 60vh;
  }
  .empty-title { font-size: 26px; font-weight: 500; letter-spacing: -0.02em; color: var(--text); margin: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 460px; }
  .chip {
    padding: 8px 16px; border-radius: var(--r-ghost);
    background: transparent; border: 1px solid var(--border);
    font-size: 12.5px; color: var(--text-2);
    transition: border-color var(--t-normal) ease, color var(--t-fast) ease;
    cursor: pointer;
  }
  .chip:hover { border-color: var(--accent); color: var(--text); }

  /* Messages — assistant is flat text on the canvas; user is a cork pill */
  .row { display: flex; max-width: 680px; width: 100%; margin: 0 auto; padding: 6px 0; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .thinking-row { padding: 12px 0; }

  .user-pill {
    background: var(--s4); color: var(--text);
    padding: 10px 16px; font-size: 14px; line-height: 1.55;
    border-radius: 18px; max-width: 72%;
  }
  .row.assistant .md-body {
    color: var(--text); font-size: 14.5px; line-height: 1.65;
    max-width: 100%; position: relative; cursor: pointer;
  }

  .attach-img { max-width: 200px; border-radius: 10px; display: block; margin-bottom: 6px; }
  .attach-label { font-size: 12px; color: var(--text-2); }

  .copied-badge {
    position: absolute; top: -22px; right: 6px;
    font-size: 10px; color: var(--safe);
    background: var(--s3); border: 1px solid var(--border);
    padding: 2px 7px; border-radius: 8px;
    pointer-events: none;
  }

  /* Markdown body */
  .md-body :global(p) { margin: 0 0 8px; }
  .md-body :global(p:last-child) { margin: 0; }
  .md-body :global(code) { background: var(--s3); padding: 1px 5px; border-radius: 4px; font-size: 12px; color: var(--accent-t); }
  .md-body :global(pre) { background: var(--s3); padding: 10px; border-radius: 8px; overflow-x: auto; }
  .md-body :global(pre code) { background: none; padding: 0; }
  .md-body :global(ul), .md-body :global(ol) { padding-left: 18px; margin: 4px 0; }
  .md-body :global(li) { margin: 2px 0; }
  .md-body :global(h1), .md-body :global(h2), .md-body :global(h3) { margin: 10px 0 4px; font-weight: 600; color: var(--text); }
  .md-body :global(strong) { font-weight: 600; color: var(--text); }
  .md-body :global(a) { color: var(--accent-t); text-decoration: underline; }
  .md-body :global(blockquote) { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--accent); color: var(--text-2); font-style: italic; }
  .md-body :global(table) { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
  .md-body :global(th), .md-body :global(td) { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  .md-body :global(th) { background: var(--s3); font-weight: 600; }

  /* Approvals */
  .approvals-bar { padding: 8px 16px; display: flex; flex-direction: column; gap: 6px; }
  .approval-card {
    max-width: 680px; margin: 0 auto; width: 100%;
    background: var(--s1); border: 1px solid var(--caution);
    border-radius: 10px; padding: 10px 12px;
    display: flex; align-items: center; gap: 10px;
  }
  .ap-info { flex: 1; min-width: 0; }
  .ap-tool { font-size: 11px; font-weight: 600; color: var(--caution); display: block; }
  .ap-summary { font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .ap-btns { display: flex; gap: 6px; flex-shrink: 0; }
  .ap-btn { padding: 5px 12px; border-radius: 14px; font-size: 11px; font-weight: 600; cursor: pointer; border: none; }
  .ap-btn.approve { background: rgba(52,211,153,0.15); color: var(--safe); border: 1px solid rgba(52,211,153,0.3); }
  .ap-btn.reject  { background: rgba(229,72,77,0.12); color: var(--danger); border: 1px solid rgba(229,72,77,0.2); }

  /* Input area */
  .input-area { padding: 10px 16px 16px; flex-shrink: 0; }

  .pill {
    max-width: 680px; margin: 0 auto;
    display: flex; align-items: flex-end; gap: 6px;
    background: var(--s2); border: 1px solid var(--border);
    border-radius: 28px; padding: 6px 6px 6px 14px;
    transition: border-color 0.2s;
  }
  .pill:focus-within { border-color: var(--border-strong); }
  .pill.listening { border-color: var(--border-strong); animation: throb-halo 2.4s ease-in-out infinite; }

  .msg-input {
    flex: 1; resize: none; border: none; background: transparent;
    color: var(--text); font-size: 13.5px; line-height: 1.5;
    padding: 5px 0; outline: none;
    max-height: 120px; overflow-y: auto;
    scrollbar-width: none;
    font-family: inherit;
  }
  .msg-input::placeholder { color: var(--text-3); }

  .circle-btn {
    width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center;
    transition: background 0.15s, box-shadow 0.15s;
    color: var(--text-2);
    border: none; cursor: pointer;
  }
  .circle-btn.mic-btn { background: var(--s3); }
  .circle-btn.mic-btn:hover { background: var(--s4); color: var(--text); }
  .circle-btn.mic-btn.active { background: var(--s4); color: var(--text); animation: throb-halo 2.4s ease-in-out infinite; }
  .circle-btn.ghost { background: transparent; color: var(--text-3); }
  .circle-btn.ghost:hover { background: var(--s3); color: var(--text-2); }
  .circle-btn.send-btn { background: var(--s4); color: var(--text); }
  .circle-btn.send-btn:hover:not(:disabled) { background: #46301e; }
  .circle-btn.send-btn:disabled { background: var(--s3); color: var(--text-3); cursor: default; }

  .diag { text-align: center; font-size: 11px; color: var(--text-3); margin: 4px 0 0; }

  /* Spinner */
  .spin-sm {
    width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid var(--border-strong);
    border-top-color: var(--text-2);
    animation: spin 0.7s linear infinite;
    display: block;
  }
  .spin-sm.white { border-color: rgba(255,237,215,0.3); border-top-color: var(--text); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
