<script>
  import { tick } from "svelte";
  import { fly } from "svelte/transition";
  import { marked } from "marked";
  import { messages, thinking, writing, generating, approvals, decideAndContinue, sendCommand,
           sendAttachment, stopGeneration, notify, me, showVoiceOverlay } from "../lib/store.js";
  import { api } from "../lib/api.js";
  import Composer from "./Composer.svelte";
  import ApprovalCard from "./ApprovalCard.svelte";
  import ConnectorPanel from "./ConnectorPanel.svelte";
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
  let docOpen = null;   // which document card's preview is expanded
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

  const DOC_ICON = { docx: "ti-file-type-docx", pdf: "ti-file-type-pdf",
                     pptx: "ti-file-type-ppt", xlsx: "ti-file-type-xls" };
  function fmtSize(n) {
    if (!n) return "";
    return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  }

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
      // Real documents (docx/pdf/xlsx/pptx/csv) parse client-side — no server round-trip,
      // works for any size. Images still go to the vision endpoint.
      const { canParse, parseDocument } = await import("../lib/docparse.js");
      if (canParse(file.name)) {
        const text = await parseDocument(file);
        if (!text.trim()) { notify(`Couldn't read ${file.name}`, "danger"); uploading = false; return; }
        await sendAttachment(file.name, file.type, text.slice(0, 60000), preview);
      } else {
        const r = await api.analyzeUpload(file);
        if (!r.ok) { notify(`Couldn't read ${file.name}`, "danger"); uploading = false; return; }
        await sendAttachment(file.name, file.type, r.reply, preview);
      }
    } catch (err) { notify(`Upload failed: ${err?.message}`, "danger"); }
    uploading = false;
  }
</script>

<div class="chat">
  <div class="thread" bind:this={threadEl} on:scroll={onThreadScroll}>
    {#if $messages.length === 0 && !$thinking}
      <div class="empty-state" in:fly={{ y: 10, duration: 300 }}>
        <span class="dotfield ef" aria-hidden="true"></span>
        <Orb size={58} state="idle" />
        <p class="empty-title">{$me.display_name ? `What are we doing today, ${$me.display_name}?` : "What are you working on?"}</p>
        <!-- One clean, consistent look for everyone: personalized suggestion pills
             when Emblem knows the user, the same-styled defaults otherwise. -->
        <div class="chips">
          {#if suggestions.length}
            {#each suggestions.slice(0, 4) as s, i (s.title)}
              <button class="chip" in:fly={{ y: 8, duration: 200, delay: i * 40 }}
                      on:click={() => chip(s.command)} title={s.line || s.command}>
                <i class="ti {SUGG_ICONS[s.icon] || 'ti-bolt'}"></i> {s.title}
              </button>
            {/each}
          {:else}
            <button class="chip" on:click={() => chip("What's on my calendar today?")}><i class="ti ti-calendar"></i> Today's calendar</button>
            <button class="chip" on:click={() => chip("Summarize my unread email")}><i class="ti ti-mail"></i> Unread email</button>
            <button class="chip" on:click={() => chip("Start a page for a new idea")}><i class="ti ti-file-text"></i> New page</button>
            <button class="chip" on:click={() => chip("Set up a morning briefing")}><i class="ti ti-bolt"></i> Daily automation</button>
          {/if}
        </div>
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
        {:else if msg.isPanel}
          <div class="row assistant" in:fly={{ y: 8, duration: 200 }}>
            <ConnectorPanel app={msg.panel.app} view={msg.panel.view} params={msg.panel.params} />
          </div>
        {:else if msg.isDoc}
          <div class="row assistant" in:fly={{ y: 8, duration: 200 }}>
            <div class="doc-wrap">
              <div class="doc-card glass gloss">
                <span class="doc-ic doc-{msg.doc.format}"><i class="ti {DOC_ICON[msg.doc.format] || 'ti-file'}"></i></span>
                <div class="doc-meta">
                  <span class="doc-title">{msg.doc.filename || msg.doc.title}</span>
                  {#if msg.doc.status === 'generating'}
                    <span class="doc-sub"><span class="doc-spin"></span> Generating your {msg.doc.format.toUpperCase()}…</span>
                  {:else if msg.doc.status === 'ready'}
                    <span class="doc-sub">{msg.doc.format.toUpperCase()} · {fmtSize(msg.doc.size)}</span>
                  {:else}
                    <span class="doc-sub err">{msg.doc.error || 'Failed to generate.'}</span>
                  {/if}
                </div>
                {#if msg.doc.status === 'ready'}
                  {#if msg.doc.spec}
                    <button class="doc-prev-btn" on:click={() => docOpen = docOpen === i ? null : i}
                            title="Preview">
                      <i class="ti {docOpen === i ? 'ti-eye-off' : 'ti-eye'}"></i>
                    </button>
                  {/if}
                  <a class="doc-dl" href={msg.doc.url} download={msg.doc.filename}>
                    <i class="ti ti-download"></i> Download
                  </a>
                {/if}
              </div>
              {#if docOpen === i && msg.doc.spec}
                <div class="doc-preview glass" transition:fly={{ y: -4, duration: 160 }}>
                  {#if msg.doc.format === 'pptx' && msg.doc.spec.slides}
                    {#each msg.doc.spec.slides as sl, si}
                      <div class="pv-slide"><span class="pv-slide-n">{si + 1}</span>
                        <div><strong>{sl.title || ''}</strong>
                          <ul>{#each (sl.bullets || []) as b}<li>{b}</li>{/each}</ul>
                        </div>
                      </div>
                    {/each}
                  {:else if msg.doc.format === 'xlsx' && msg.doc.spec.sheets}
                    {#each msg.doc.spec.sheets as sh}
                      <p class="pv-sheet">{sh.name || 'Sheet'}</p>
                      <div class="pv-tablewrap"><table class="pv-table">
                        {#if sh.headers}<tr>{#each sh.headers as h}<th>{h}</th>{/each}</tr>{/if}
                        {#each (sh.rows || []).slice(0, 12) as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}
                      </table></div>
                    {/each}
                  {:else}
                    <div class="pv-doc md-body">{@html render(msg.doc.spec.content || '')}</div>
                  {/if}
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
    min-height: 55vh; position: relative;
  }
  .empty-state .ef { top: 0; left: 50%; transform: translateX(-50%); width: 480px; height: 340px; }
  .empty-title { font-size: 28px; font-weight: 500; letter-spacing: -0.02em; color: var(--text); margin: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 480px; }
  .chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 15px; border-radius: var(--r-pill);
    background: var(--s1); border: 1px solid var(--border);
    font-size: 13px; font-weight: 500; color: var(--text-2);
    transition: border-color var(--t-fast), color var(--t-fast), background var(--t-fast), transform var(--t-fast);
    cursor: pointer; max-width: 100%;
  }
  .chip i { font-size: 15px; opacity: 0.75; }
  .chip:hover { border-color: var(--border-strong); color: var(--text); background: var(--s2); transform: translateY(-1px); }
  .chip:hover i { opacity: 1; }


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

  /* Document card (create_document result) */
  .doc-card {
    display: flex; align-items: center; gap: 14px; width: 100%; max-width: 460px;
    padding: 14px 16px; border-radius: var(--r-lg); box-shadow: var(--shadow-md);
  }
  .doc-ic {
    width: 44px; height: 44px; border-radius: var(--r-md); flex-shrink: 0;
    display: grid; place-items: center; font-size: 24px;
    background: var(--s2); color: var(--text);
  }
  .doc-docx { color: #2b7cd3; } .doc-pdf { color: #d3402b; }
  .doc-pptx { color: #d35b2b; } .doc-xlsx { color: #1f9d55; }
  .doc-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .doc-title { font-size: 14px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .doc-sub { font-size: 12px; color: var(--text-3); display: inline-flex; align-items: center; gap: 6px; }
  .doc-sub.err { color: var(--danger); }
  .doc-spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--text-2); animation: spin 0.7s linear infinite; display: inline-block; }
  .doc-dl {
    flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: var(--r-sm); text-decoration: none;
    background: var(--accent-grad); color: var(--accent-t); font-size: 13px; font-weight: 500;
    box-shadow: 0 2px 10px var(--accent-glow); transition: filter var(--t-fast);
  }
  .doc-dl:hover { filter: brightness(1.08); }
  .doc-prev-btn {
    width: 36px; height: 36px; border-radius: var(--r-sm); flex-shrink: 0;
    display: grid; place-items: center; color: var(--text-2); font-size: 17px;
    transition: color var(--t-fast), background var(--t-fast);
  }
  .doc-prev-btn:hover { color: var(--text); background: var(--s2); }

  .doc-wrap { display: flex; flex-direction: column; gap: 8px; max-width: 460px; width: 100%; }
  .doc-preview {
    border-radius: var(--r-md); padding: 16px 18px; max-height: 340px; overflow-y: auto;
    font-size: 13px; line-height: 1.55;
  }
  .doc-preview .pv-doc :global(h1) { font-size: 18px; margin: 0 0 8px; }
  .doc-preview .pv-doc :global(h2) { font-size: 15px; margin: 12px 0 4px; }
  .doc-preview .pv-doc :global(p) { margin: 0 0 8px; color: var(--text-2); }
  .doc-preview .pv-doc :global(ul) { margin: 4px 0; padding-left: 18px; color: var(--text-2); }
  .pv-slide { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--divider); }
  .pv-slide:last-child { border-bottom: none; }
  .pv-slide-n { flex-shrink: 0; width: 22px; height: 22px; border-radius: 5px; background: var(--s2); color: var(--text-3); display: grid; place-items: center; font-size: 11px; font-weight: 500; }
  .pv-slide ul { margin: 4px 0 0; padding-left: 16px; color: var(--text-2); }
  .pv-sheet { font-size: 12px; font-weight: 500; color: var(--text-3); margin: 8px 0 4px; }
  .pv-tablewrap { overflow-x: auto; }
  .pv-table { border-collapse: collapse; font-size: 12px; }
  .pv-table th, .pv-table td { border: 1px solid var(--border); padding: 4px 9px; text-align: left; color: var(--text-2); }
  .pv-table th { background: var(--s1); font-weight: 500; color: var(--text); }

  .attach-img { max-width: 220px; border-radius: 12px; display: block; margin-bottom: 6px; }
  .attach-label { font-size: 13px; color: var(--text-2); }

  .md-body :global(p) { margin: 0 0 10px; }
  .md-body :global(p:last-child) { margin: 0; }
  .md-body :global(code) { background: var(--s2); padding: 1px 6px; border-radius: 5px; font-size: 13px;
    font-family: var(--font-mono); font-style: normal; }
  .md-body :global(pre) { background: var(--s1); border: 1px solid var(--border); padding: 12px 14px; border-radius: 12px; overflow-x: auto;
    font-family: var(--font-mono); font-style: normal; }
  .md-body :global(pre code) { background: none; padding: 0; }
  .md-body :global(ul), .md-body :global(ol) { padding-left: 20px; margin: 6px 0; }
  .md-body :global(li) { margin: 3px 0; }
  .md-body :global(h1), .md-body :global(h2), .md-body :global(h3) { margin: 12px 0 6px; font-weight: 500; color: var(--text);
    font-family: var(--font-ui); font-style: normal; }
  .md-body :global(strong) { font-weight: 500; color: var(--text); }
  .md-body :global(a) { color: var(--accent-ink); text-decoration: underline; }
  .md-body :global(blockquote) { margin: 10px 0; padding: 4px 14px; border-left: 3px solid var(--accent); color: var(--text-2); }
  .md-body :global(table) { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px;
    font-family: var(--font-ui); font-style: normal; }
  .md-body :global(th), .md-body :global(td) { border: 1px solid var(--border); padding: 7px 11px; text-align: left; }
  .md-body :global(th) { background: var(--s1); font-weight: 500; }

  .approvals-bar { padding: 8px 16px; display: flex; flex-direction: column; gap: 8px; }
  .approval-slot { max-width: 720px; margin: 0 auto; width: 100%; }

  .input-area { padding: 8px 16px 12px; flex-shrink: 0; }
  .input-area :global(.composer) { max-width: 720px; margin: 0 auto; }
  .footnote {
    max-width: 720px; margin: 8px auto 0; text-align: center;
    font-size: 11.5px; color: var(--text-3);
  }
</style>
