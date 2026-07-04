<script>
  import { tick } from "svelte";
  import { fly } from "svelte/transition";
  import { marked } from "marked";
  import { messages, thinking, writing, generating, approvals, decideAndContinue, sendCommand,
           sendAttachment, stopGeneration, notify, me, showVoiceOverlay } from "../lib/store.js";
  import { api } from "../lib/api.js";
  import Composer from "./Composer.svelte";
  import ApprovalCard from "./ApprovalCard.svelte";
  import Orb from "./Orb.svelte";

  marked.setOptions({ gfm: true, breaks: true });
  function render(text) {
    try { return marked.parse(String(text || "")); } catch { return String(text || ""); }
  }

  let uploading = false;
  let composer;

  // ── Personalized suggestions (from what Emblem knows about the user) ──
  import { onMount } from "svelte";
  let suggestions = [];
  const SUGG_ICONS = {
    mail: "ti-mail", calendar: "ti-calendar", code: "ti-brand-github",
    notes: "ti-file-text", bolt: "ti-bolt", share: "ti-share",
    mic: "ti-microphone", plug: "ti-plug-connected",
  };
  onMount(async () => {
    try { suggestions = (await api.suggestions()).items || []; }
    catch (e) { console.warn("suggestions unavailable:", e?.message); }
  });

  // ── Auto-scroll ────────────────────────────────────────────────
  // Stick to the bottom ONLY when the user is already near it. If they've scrolled
  // up to read (even mid-typewriter), never yank them back down — they can scroll
  // freely no matter what the assistant is doing.
  let threadEl;
  let stick = true;
  function onThreadScroll() {
    if (!threadEl) return;
    const gap = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight;
    stick = gap < 120;
  }
  $: if ($messages.length || $thinking || $writing) maybeScroll();
  async function maybeScroll() {
    await tick();
    if (threadEl && stick) threadEl.scrollTop = threadEl.scrollHeight;
  }

  // ── Copy ───────────────────────────────────────────────────────
  let copiedIdx = null;
  let memOpen = null;   // which message's "used memory" list is expanded
  async function copy(t, i) {
    try { await navigator.clipboard.writeText(t); } catch {
      const el = document.createElement("textarea");
      el.value = t; el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
    }
    copiedIdx = i;
    setTimeout(() => copiedIdx = null, 1800);
  }

  function submit(e) { sendCommand(e.detail); }
  function chip(t) { sendCommand(t); }

  // Copy-and-edit: drop a past prompt back into the composer to tweak and resend.
  function editPrompt(text) {
    composer?.setText(text);
  }

  // ── Approvals ──────────────────────────────────────────────────
  // Cards drive running/done/error through decideAndContinue. A settled card
  // stays visible briefly (done flash / error message) even after refresh()
  // drops it from $approvals.pending, so we keep a local snapshot of it.
  let apStates = {};    // id -> { state, error }
  let apGhosts = {};    // id -> approval row snapshot (settled but still shown)

  $: approvalCards = [
    ...($approvals.pending || []).slice(0, 3),
    ...Object.values(apGhosts).filter(
      (g) => !($approvals.pending || []).some((p) => p.id === g.id)
    ),
  ];

  async function decideApproval(ap, approved) {
    apGhosts = { ...apGhosts, [ap.id]: ap };
    apStates = { ...apStates, [ap.id]: { state: "running", error: "" } };
    const r = await decideAndContinue(ap.id, approved, ap.summary);
    if (approved && r && !r.ok) {
      apStates = { ...apStates, [ap.id]: { state: "error", error: r.error || "The action failed." } };
      dropCard(ap.id, 4000);
    } else {
      apStates = { ...apStates, [ap.id]: { state: "done", error: "" } };
      dropCard(ap.id, 1400);
    }
  }

  function dropCard(id, after) {
    setTimeout(() => {
      const { [id]: _g, ...ghosts } = apGhosts;
      const { [id]: _s, ...states } = apStates;
      apGhosts = ghosts;
      apStates = states;
    }, after);
  }

  async function handleFile(e) {
    const file = e.detail; if (!file) return;
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
</script>

<div class="chat">
  <div class="thread" bind:this={threadEl} on:scroll={onThreadScroll}>
    {#if $messages.length === 0 && !$thinking}
      <div class="empty-state" in:fly={{ y: 10, duration: 300 }}>
        <Orb size={58} state="idle" />
        <p class="empty-title">{$me.display_name ? `What are we doing today, ${$me.display_name}?` : "What are you working on?"}</p>
        {#if suggestions.length}
          <!-- Personalized workflow suggestions — generated from what Emblem
               learned about this user, not canned chips. -->
          <div class="sugg-grid">
            {#each suggestions as s, i (s.title)}
              <button class="sugg glass" in:fly={{ y: 8, duration: 200, delay: i * 50 }}
                      on:click={() => chip(s.command)} title={s.command}>
                <span class="sugg-icon"><i class="ti {SUGG_ICONS[s.icon] || 'ti-bolt'}"></i></span>
                <span class="sugg-body">
                  <span class="sugg-title">{s.title}</span>
                  <span class="sugg-line">{s.line}</span>
                </span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="chips">
            <button class="chip" on:click={() => chip("What's on my calendar today?")}>Today's calendar</button>
            <button class="chip" on:click={() => chip("Summarize my unread email")}>Unread email</button>
            <button class="chip" on:click={() => chip("Start a page for a new idea")}>New page</button>
            <button class="chip" on:click={() => chip("Set up a morning briefing")}>Daily automation</button>
          </div>
        {/if}
      </div>
    {:else}
      {#each $messages as msg, i}
        {#if msg.role === "user"}
          <div class="row user" in:fly={{ y: 8, duration: 200 }}>
            <div class="msg-col user-col">
              <div class="user-pill">
                {#if msg.imagePreview}<img src={msg.imagePreview} alt="attachment" class="attach-img"/>{/if}
                {#if msg.isAttachment}
                  <span class="attach-label"><i class="ti ti-paperclip"></i> {msg.attachmentName}</span>
                {:else}
                  {msg.text}
                {/if}
              </div>
              {#if !msg.isAttachment}
                <div class="msg-actions user-actions">
                  <button class="act" on:click={() => copy(msg.text, i)} title="Copy">
                    <i class="ti {copiedIdx === i ? 'ti-check' : 'ti-copy'}"></i>
                    <span>{copiedIdx === i ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button class="act" on:click={() => editPrompt(msg.text)} title="Edit and resend">
                    <i class="ti ti-pencil"></i><span>Edit</span>
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <div class="row assistant" in:fly={{ y: 8, duration: 200 }}>
            <div class="msg-col">
              <div class="md-body" class:writing={$writing && i === $messages.length - 1}>{@html render(msg.text)}</div>
              {#if msg.usedMemories && msg.usedMemories.length}
                <button class="mem-chip" class:open={memOpen === i}
                        on:click={() => memOpen = memOpen === i ? null : i}
                        title="This reply used what Emblem remembers about you">
                  <i class="ti ti-brain"></i>
                  <span>Personalized from memory</span>
                  <i class="ti {memOpen === i ? 'ti-chevron-up' : 'ti-chevron-down'} chev"></i>
                </button>
                {#if memOpen === i}
                  <ul class="mem-used" transition:fly={{ y: -4, duration: 150 }}>
                    {#each msg.usedMemories as um}<li>{um.content}</li>{/each}
                  </ul>
                {/if}
              {/if}
              {#if !($writing && i === $messages.length - 1)}
                <div class="msg-actions">
                  <button class="act" on:click={() => copy(msg.text, i)} title="Copy">
                    <i class="ti {copiedIdx === i ? 'ti-check' : 'ti-copy'}"></i>
                    <span>{copiedIdx === i ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}

      {#if $thinking}
        <div class="row assistant thinking-row" in:fly={{ y: 6, duration: 200 }}>
          <div class="dots" aria-label="Emblem is thinking">
            <span></span><span></span><span></span>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  {#if approvalCards.length > 0}
    <div class="approvals-bar">
      {#each approvalCards as ap (ap.id)}
        <div class="approval-slot" in:fly={{ y: 10, duration: 250 }}>
          <ApprovalCard
            approval={ap}
            variant="inline"
            state={apStates[ap.id]?.state || "idle"}
            error={apStates[ap.id]?.error || ""}
            on:approve={() => decideApproval(ap, true)}
            on:decline={() => decideApproval(ap, false)}
          />
        </div>
      {/each}
    </div>
  {/if}

  <div class="input-area">
    <Composer
      bind:this={composer}
      generating={$generating}
      {uploading}
      on:submit={submit}
      on:attach={handleFile}
      on:mic={() => showVoiceOverlay.set(true)}
      on:stop={stopGeneration}
    />
    <p class="footnote">Emblem can act in your connected apps — consequential actions always ask first.</p>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--bg); }

  .thread {
    flex: 1; overflow-y: auto; padding: 28px 16px 8px;
    display: flex; flex-direction: column; gap: 4px;
    scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent;
  }
  .thread > * { max-width: 720px; width: 100%; margin: 0 auto; }

  .empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    flex: 1; gap: 24px; padding: 60px 20px; text-align: center;
    min-height: 55vh;
  }
  .empty-title { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); margin: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 480px; }
  .chip {
    padding: 8px 16px; border-radius: var(--r-pill);
    background: var(--bg); border: 1px solid var(--border);
    font-size: 13px; color: var(--text-2);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--t-fast), color var(--t-fast), box-shadow var(--t-fast);
    cursor: pointer;
  }
  .chip:hover { border-color: var(--accent); color: var(--text); box-shadow: 0 0 0 3px var(--accent-bg); }

  .sugg-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; max-width: 620px; width: 100%; }
  @media (max-width: 640px) { .sugg-grid { grid-template-columns: 1fr; } }
  .sugg {
    display: flex; align-items: flex-start; gap: 12px; text-align: left;
    padding: 13px 15px; border-radius: var(--r-md);
    box-shadow: var(--shadow-sm); cursor: pointer;
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .sugg:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .sugg-icon {
    width: 32px; height: 32px; border-radius: var(--r-sm); flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    display: grid; place-items: center; font-size: 17px;
  }
  .sugg-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .sugg-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
  .sugg-line { font-size: 12px; line-height: 1.45; color: var(--text-2); }

  .row { display: flex; max-width: 720px; width: 100%; margin: 0 auto; padding: 7px 0; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .thinking-row { padding: 14px 0; }

  /* Three-dot thinking indicator (replaces the orb) */
  .dots { display: inline-flex; gap: 5px; align-items: center; height: 20px; padding-left: 2px; }
  .dots span {
    width: 7px; height: 7px; border-radius: 50%; background: var(--text-3);
    animation: dot-bounce 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(2) { animation-delay: 0.15s; }
  .dots span:nth-child(3) { animation-delay: 0.3s; }

  /* Blinking caret trailing the message being typed */
  .md-body.writing :global(> :last-child)::after {
    content: "▍"; display: inline-block; margin-left: 1px;
    color: var(--text-2); font-weight: 400;
    animation: caret-blink 1s step-end infinite;
  }
  @keyframes caret-blink { 50% { opacity: 0; } }

  .msg-col { display: flex; flex-direction: column; gap: 4px; max-width: 100%; }
  .user-col { align-items: flex-end; max-width: 72%; }

  .user-pill {
    background: var(--s2); color: var(--text);
    padding: 10px 16px; font-size: 15px; line-height: 1.55;
    border-radius: 20px 20px 6px 20px;
    border: 1px solid var(--border);
  }
  .row.assistant .md-body {
    color: var(--text); font-size: 15px; line-height: 1.7;
    max-width: 100%; position: relative;
  }

  /* Hover actions under each message: Copy (both) + Edit (user prompts) */
  .msg-actions {
    display: flex; gap: 4px; padding: 0 2px;
    opacity: 0; transition: opacity var(--t-fast);
  }
  .user-actions { justify-content: flex-end; }
  .row:hover .msg-actions, .msg-actions:focus-within { opacity: 1; }
  .act {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 8px; border-radius: var(--r-sm);
    font-size: 12px; color: var(--text-3);
    transition: color var(--t-fast), background var(--t-fast);
  }
  .act:hover { color: var(--text); background: var(--s2); }
  .act i { font-size: 14px; }
  @media (hover: none) { .msg-actions { opacity: 1; } }

  /* "Personalized from memory" transparency chip (Claude-style) */
  .mem-chip {
    display: inline-flex; align-items: center; gap: 6px; margin-top: 2px;
    padding: 4px 10px; border-radius: var(--r-pill);
    background: var(--accent-bg); border: 1px solid var(--border);
    font-size: 11.5px; font-weight: 500; color: var(--text-2); cursor: pointer;
    transition: color var(--t-fast), border-color var(--t-fast);
  }
  .mem-chip:hover, .mem-chip.open { color: var(--text); border-color: var(--border-strong); }
  .mem-chip i { font-size: 13px; }
  .mem-chip .chev { font-size: 12px; opacity: 0.7; }
  .mem-used {
    list-style: none; margin: 6px 0 0; padding: 10px 12px;
    background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-md);
    display: flex; flex-direction: column; gap: 6px; max-width: 520px;
  }
  .mem-used li { font-size: 12.5px; line-height: 1.45; color: var(--text-2); padding-left: 16px; position: relative; }
  .mem-used li::before { content: "🧠"; position: absolute; left: 0; font-size: 11px; }

  .attach-img { max-width: 220px; border-radius: 12px; display: block; margin-bottom: 6px; }
  .attach-label { font-size: 13px; color: var(--text-2); }

  .md-body :global(p) { margin: 0 0 10px; }
  .md-body :global(p:last-child) { margin: 0; }
  .md-body :global(code) { background: var(--s2); padding: 1px 6px; border-radius: 5px; font-size: 13px; }
  .md-body :global(pre) { background: var(--s1); border: 1px solid var(--border); padding: 12px 14px; border-radius: 12px; overflow-x: auto; }
  .md-body :global(pre code) { background: none; padding: 0; }
  .md-body :global(ul), .md-body :global(ol) { padding-left: 20px; margin: 6px 0; }
  .md-body :global(li) { margin: 3px 0; }
  .md-body :global(h1), .md-body :global(h2), .md-body :global(h3) { margin: 12px 0 6px; font-weight: 600; color: var(--text); }
  .md-body :global(strong) { font-weight: 600; color: var(--text); }
  .md-body :global(a) { color: var(--accent-ink); text-decoration: underline; }
  .md-body :global(blockquote) { margin: 10px 0; padding: 4px 14px; border-left: 3px solid var(--accent); color: var(--text-2); }
  .md-body :global(table) { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
  .md-body :global(th), .md-body :global(td) { border: 1px solid var(--border); padding: 7px 11px; text-align: left; }
  .md-body :global(th) { background: var(--s1); font-weight: 600; }

  .approvals-bar { padding: 8px 16px; display: flex; flex-direction: column; gap: 8px; }
  .approval-slot { max-width: 720px; margin: 0 auto; width: 100%; }

  .input-area { padding: 8px 16px 12px; flex-shrink: 0; }
  .input-area :global(.composer) { max-width: 720px; margin: 0 auto; }
  .footnote {
    max-width: 720px; margin: 8px auto 0; text-align: center;
    font-size: 11.5px; color: var(--text-3);
  }
</style>
