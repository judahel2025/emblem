<script>
  import { tick } from "svelte";
  import { fly } from "svelte/transition";
  import { marked } from "marked";
  import { messages, thinking, approvals, decide, sendCommand, sendAttachment,
           notify, me, showVoiceOverlay } from "../lib/store.js";
  import { api } from "../lib/api.js";
  import Composer from "./Composer.svelte";
  import Orb from "./Orb.svelte";

  marked.setOptions({ gfm: true, breaks: true });
  function render(text) {
    try { return marked.parse(String(text || "")); } catch { return String(text || ""); }
  }

  let uploading = false;
  let composer;

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

  function submit(e) { sendCommand(e.detail); }
  function chip(t) { sendCommand(t); }

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
  <div class="thread" bind:this={threadEl}>
    {#if $messages.length === 0 && !$thinking}
      <div class="empty-state" in:fly={{ y: 10, duration: 300 }}>
        <Orb size={58} state="idle" />
        <p class="empty-title">{$me.display_name ? `What are we doing today, ${$me.display_name}?` : "What are you working on?"}</p>
        <div class="chips">
          <button class="chip" on:click={() => chip("What's on my calendar today?")}>Today's calendar</button>
          <button class="chip" on:click={() => chip("Summarize my unread email")}>Unread email</button>
          <button class="chip" on:click={() => chip("Start a page for a new idea")}>New page</button>
          <button class="chip" on:click={() => chip("Set up a morning briefing")}>Daily automation</button>
        </div>
      </div>
    {:else}
      {#each $messages as msg, i}
        {#if msg.role === "user"}
          <div class="row user" in:fly={{ y: 8, duration: 200 }}>
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
          <div class="row assistant" in:fly={{ y: 8, duration: 200 }}>
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
          <Orb size={18} state="thinking" />
        </div>
      {/if}
    {/if}
  </div>

  {#if ($approvals.pending || []).length > 0}
    <div class="approvals-bar">
      {#each $approvals.pending.slice(0, 3) as ap (ap.id)}
        <div class="approval-card glass" in:fly={{ y: 10, duration: 250 }}>
          <div class="ap-icon"><i class="ti ti-shield-question"></i></div>
          <div class="ap-info">
            <span class="ap-summary">{ap.summary}</span>
            <span class="ap-hint">Nothing happens until you decide.</span>
          </div>
          <div class="ap-btns">
            <button class="ap-btn approve" on:click={() => decide(ap.id, true)}>Approve</button>
            <button class="ap-btn reject" on:click={() => decide(ap.id, false)}>Decline</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="input-area">
    <Composer
      bind:this={composer}
      disabled={$thinking}
      {uploading}
      on:submit={submit}
      on:attach={handleFile}
      on:mic={() => showVoiceOverlay.set(true)}
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

  .row { display: flex; max-width: 720px; width: 100%; margin: 0 auto; padding: 7px 0; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .thinking-row { padding: 14px 0; }

  .user-pill {
    background: var(--s2); color: var(--text);
    padding: 10px 16px; font-size: 15px; line-height: 1.55;
    border-radius: 20px 20px 6px 20px; max-width: 72%;
    border: 1px solid var(--border);
  }
  .row.assistant .md-body {
    color: var(--text); font-size: 15px; line-height: 1.7;
    max-width: 100%; position: relative; cursor: pointer;
  }

  .attach-img { max-width: 220px; border-radius: 12px; display: block; margin-bottom: 6px; }
  .attach-label { font-size: 13px; color: var(--text-2); }

  .copied-badge {
    position: absolute; top: -24px; right: 6px;
    font-size: 11px; color: var(--safe);
    background: var(--safe-bg); border: 1px solid var(--safe);
    padding: 2px 8px; border-radius: 9px;
    pointer-events: none;
  }

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
  .approval-card {
    max-width: 720px; margin: 0 auto; width: 100%;
    border-radius: var(--r-lg); padding: 12px 14px;
    display: flex; align-items: center; gap: 12px;
    border-color: var(--caution);
    box-shadow: var(--shadow-md);
  }
  .ap-icon {
    width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
    background: var(--caution-bg); color: var(--caution);
    display: grid; place-items: center; font-size: 18px;
  }
  .ap-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .ap-summary { font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
  .ap-hint { font-size: 12px; color: var(--text-3); }
  .ap-btns { display: flex; gap: 6px; flex-shrink: 0; }
  .ap-btn { padding: 7px 16px; border-radius: var(--r-pill); font-size: 13px; font-weight: 600; cursor: pointer;
    transition: filter var(--t-fast), background var(--t-fast); }
  .ap-btn.approve { background: var(--accent-grad); color: var(--accent-t); box-shadow: 0 2px 8px var(--accent-glow); }
  .ap-btn.approve:hover { filter: brightness(1.07); }
  .ap-btn.reject { background: transparent; color: var(--text-2); border: 1px solid var(--border-strong); }
  .ap-btn.reject:hover { color: var(--danger); border-color: var(--danger); }

  .input-area { padding: 8px 16px 12px; flex-shrink: 0; }
  .input-area :global(.composer) { max-width: 720px; margin: 0 auto; }
  .footnote {
    max-width: 720px; margin: 8px auto 0; text-align: center;
    font-size: 11.5px; color: var(--text-3);
  }
</style>
