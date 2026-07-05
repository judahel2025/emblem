<script>
  // Mail workspace — two-pane inbox over the connected account.
  // Reads run free through runConnected; sends/replies pause for approval
  // (the parent WorkspaceHost renders the approval card via onApproval).
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { runConnected } from "../../lib/workspaces.js";

  export let onApproval;

  // ── List state ────────────────────────────────────────────────
  let messages = [];
  let loading = true;
  let listError = "";
  let query = "";

  // ── Open message state ────────────────────────────────────────
  let openId = null;
  let openMsg = null;
  let openLoading = false;
  let openError = "";

  // ── Reply state ───────────────────────────────────────────────
  let replyText = "";
  let replying = false;
  let replyNotice = "";
  let replyError = "";

  // ── Compose state ─────────────────────────────────────────────
  let composing = false;
  let cTo = "";
  let cSubject = "";
  let cBody = "";
  let sending = false;
  let sendNotice = "";
  let sendError = "";

  let debuggedList = false;
  let debuggedMsg = false;

  // ── Defensive shape helpers (connected-app responses vary) ────
  function asArray(res) {
    const list = res?.messages ?? res?.data?.messages ?? res;
    return Array.isArray(list) ? list : [];
  }
  const mid = (m) => m?.messageId ?? m?.id ?? "";
  const msender = (m) => m?.sender ?? m?.from ?? "";
  const mdate = (m) => m?.messageTimestamp ?? m?.date ?? "";
  const msnippet = (m) => {
    const p = m?.preview ?? m?.snippet ?? "";
    if (p && typeof p === "object") return p.body ?? p.text ?? "";
    return typeof p === "string" ? p : "";
  };
  const isUnread = (m) => Array.isArray(m?.labelIds) && m.labelIds.includes("UNREAD");

  function senderName(s) {
    const str = String(s || "").trim();
    const m = str.match(/^"?([^"<]*)"?\s*</);
    const name = m && m[1].trim();
    return name || str.replace(/[<>]/g, "") || "Unknown sender";
  }
  function emailOf(s) {
    const m = String(s || "").match(/<([^>]+)>/);
    return (m ? m[1] : String(s || "")).trim();
  }

  function relDate(v) {
    try {
      const d = new Date(typeof v === "number" ? v : String(v));
      if (isNaN(d.getTime())) return "";
      const s = (Date.now() - d.getTime()) / 1000;
      if (s < 60) return "now";
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch { return ""; }
  }
  function fullDate(v) {
    try {
      const d = new Date(typeof v === "number" ? v : String(v));
      if (isNaN(d.getTime())) return String(v || "");
      return d.toLocaleString([], { weekday: "short", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    } catch { return String(v || ""); }
  }

  // ── HTML sanitization: DOMParser walk, no scripts/styles/iframes/on* ──
  function sanitizeHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html), "text/html");
      doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form, base").forEach((n) => n.remove());
      for (const el of doc.body.querySelectorAll("*")) {
        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase();
          const val = String(attr.value || "");
          if (name.startsWith("on") || name === "srcdoc") el.removeAttribute(attr.name);
          else if ((name === "href" || name === "src" || name === "xlink:href" || name === "action") && /^\s*(javascript|vbscript|data:text\/html)/i.test(val)) el.removeAttribute(attr.name);
        }
        if (el.tagName === "A") {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      }
      return doc.body.innerHTML;
    } catch {
      try { return ""; } catch { return ""; }
    }
  }
  function htmlToText(html) {
    try { return new DOMParser().parseFromString(String(html), "text/html").body.textContent || ""; }
    catch { return ""; }
  }

  // Decode base64url payload parts (raw API shape fallback).
  function b64(s) {
    const norm = String(s).replace(/-/g, "+").replace(/_/g, "/");
    try { return decodeURIComponent(escape(atob(norm))); }
    catch { try { return atob(norm); } catch { return ""; } }
  }
  function walkPayload(p, out = { text: "", html: "" }) {
    if (!p || typeof p !== "object") return out;
    if (p.mimeType === "text/plain" && p.body?.data && !out.text) out.text = b64(p.body.data);
    if (p.mimeType === "text/html" && p.body?.data && !out.html) out.html = b64(p.body.data);
    for (const part of p.parts || []) walkPayload(part, out);
    return out;
  }

  const looksLikeHtml = (s) => /<\/?(html|body|div|p|br|table|td|tr|span|a|img|h[1-6])\b/i.test(String(s));

  function normalizeMessage(raw, listItem) {
    const res = raw?.data ?? raw ?? {};
    const subject = res.subject ?? listItem?.subject ?? "(no subject)";
    const from = res.sender ?? res.from ?? msender(listItem);
    const to = res.to ?? res.recipient ?? "";
    const date = res.messageTimestamp ?? res.date ?? mdate(listItem);
    const threadId = res.threadId ?? listItem?.threadId ?? "";
    let text = typeof res.messageText === "string" ? res.messageText : (typeof res.text === "string" ? res.text : "");
    let html = typeof res.messageHtml === "string" ? res.messageHtml : (typeof res.html === "string" ? res.html : "");
    if (!text && !html && res.payload) {
      const found = walkPayload(res.payload);
      text = found.text; html = found.html;
    }
    // Sometimes the "text" field actually carries HTML.
    if (text && !html && looksLikeHtml(text)) { html = text; text = ""; }
    let safeHtml = "";
    if (!text && html) {
      safeHtml = sanitizeHtml(html);
      if (!safeHtml) text = htmlToText(html); // last resort: plain text
    }
    if (!text && !safeHtml) text = msnippet(listItem) || "(no content)";
    return { subject, from, to, date, threadId, text, safeHtml };
  }

  // ── Actions ───────────────────────────────────────────────────
  async function load() {
    loading = true;
    listError = "";
    try {
      const params = { max_results: 25 };
      if (query.trim()) params.query = query.trim();
      const res = await runConnected("GMAIL_FETCH_EMAILS", params);
      if (!debuggedList) { console.debug("[mail] list response:", res); debuggedList = true; }
      messages = asArray(res);
    } catch (e) {
      listError = e?.message || "Couldn't load your inbox.";
      messages = [];
    }
    loading = false;
  }

  async function openMessage(m) {
    const id = mid(m);
    if (!id) return;
    composing = false;
    openId = id;
    openMsg = null;
    openError = "";
    openLoading = true;
    replyText = ""; replyNotice = ""; replyError = "";
    try {
      const res = await runConnected("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", { message_id: id, format: "full" });
      if (!debuggedMsg) { console.debug("[mail] message response:", res); debuggedMsg = true; }
      openMsg = normalizeMessage(res, m);
    } catch (e) {
      openError = e?.message || "Couldn't open this message.";
    }
    openLoading = false;
  }

  function closeMessage() {
    openId = null;
    openMsg = null;
    openError = "";
  }

  async function sendReply() {
    if (!replyText.trim() || !openMsg?.threadId) return;
    replying = true;
    replyError = ""; replyNotice = "";
    try {
      await runConnected(
        "GMAIL_REPLY_TO_THREAD",
        { thread_id: openMsg.threadId, message_body: replyText.trim(), recipient_email: emailOf(openMsg.from) },
        { act: true, onApproval },
      );
      replyNotice = "Reply sent.";
      replyText = "";
    } catch (e) {
      replyError = e?.message || "Couldn't send the reply.";
    }
    replying = false;
  }

  function startCompose() {
    composing = true;
    openId = null; openMsg = null; openError = "";
    sendNotice = ""; sendError = "";
  }

  async function sendCompose() {
    if (!cTo.trim() || !cBody.trim()) return;
    sending = true;
    sendError = ""; sendNotice = "";
    try {
      await runConnected(
        "GMAIL_SEND_EMAIL",
        { recipient_email: cTo.trim(), subject: cSubject.trim(), body: cBody },
        { act: true, onApproval },
      );
      sendNotice = "Message sent.";
      cTo = ""; cSubject = ""; cBody = "";
    } catch (e) {
      sendError = e?.message || "Couldn't send the message.";
    }
    sending = false;
  }

  onMount(load);
</script>

<div class="mail">
  <div class="toolbar">
    <form class="search" on:submit|preventDefault={load} role="search">
      <i class="ti ti-search" aria-hidden="true"></i>
      <input bind:value={query} placeholder="Search your inbox…" aria-label="Search messages" />
    </form>
    <button class="btn ghost iconbtn" on:click={load} disabled={loading} aria-label="Refresh inbox" title="Refresh">
      {#if loading}<span class="spin"></span>{:else}<i class="ti ti-refresh"></i>{/if}
    </button>
    <button class="btn primary" on:click={startCompose} aria-label="Compose a new message">
      <i class="ti ti-pencil"></i> Compose
    </button>
  </div>

  <div class="panes" class:opened={openId || composing}>
    <!-- ── Message list ── -->
    <div class="list" aria-label="Message list">
      {#if loading}
        <div class="state"><span class="spin"></span> Loading your inbox…</div>
      {:else if listError}
        <div class="state error">
          <p>{listError}</p>
          <button class="btn" on:click={load}>Try again</button>
        </div>
      {:else if messages.length === 0}
        <div class="empty">{query.trim() ? "No messages match that search." : "Your inbox is empty."}</div>
      {:else}
        {#each messages as m (mid(m))}
          <button
            class="row"
            class:active={openId === mid(m)}
            class:unread={isUnread(m)}
            on:click={() => openMessage(m)}
            aria-label={`Open message from ${senderName(msender(m))}: ${m.subject || "(no subject)"}`}
          >
            <div class="row-top">
              <span class="from">{senderName(msender(m))}</span>
              <span class="when">{relDate(mdate(m))}</span>
            </div>
            <div class="subj">{m.subject || "(no subject)"}</div>
            {#if msnippet(m)}<div class="snip">{msnippet(m)}</div>{/if}
          </button>
        {/each}
      {/if}
    </div>

    <!-- ── Reader / compose pane ── -->
    <div class="reader">
      {#if composing}
        <div class="compose" in:fly={{ y: 10, duration: 180 }}>
          <div class="reader-top">
            <button class="btn ghost backbtn" on:click={() => (composing = false)} aria-label="Back to inbox">
              <i class="ti ti-arrow-left"></i> Inbox
            </button>
            <h2>New message</h2>
          </div>
          <label class="field">
            <span>To</span>
            <input type="email" bind:value={cTo} placeholder="name@example.com" aria-label="Recipient email" />
          </label>
          <label class="field">
            <span>Subject</span>
            <input bind:value={cSubject} placeholder="Subject" aria-label="Subject" />
          </label>
          <label class="field grow">
            <span>Message</span>
            <textarea bind:value={cBody} rows="10" placeholder="Write your message…" aria-label="Message body"></textarea>
          </label>
          {#if sendNotice}<p class="notice safe" in:fly={{ y: 6, duration: 150 }}><i class="ti ti-check"></i> {sendNotice}</p>{/if}
          {#if sendError}<p class="notice danger" in:fly={{ y: 6, duration: 150 }}>{sendError}</p>{/if}
          <div class="actions">
            <button class="btn primary" on:click={sendCompose} disabled={sending || !cTo.trim() || !cBody.trim()} aria-label="Send message">
              {#if sending}<span class="spin"></span>{:else}<i class="ti ti-send"></i>{/if} Send
            </button>
            <button class="btn ghost" on:click={() => (composing = false)}>Cancel</button>
          </div>
        </div>
      {:else if openLoading}
        <div class="state"><span class="spin"></span> Opening message…</div>
      {:else if openError}
        <div class="state error">
          <p>{openError}</p>
          <button class="btn" on:click={closeMessage}>Back to inbox</button>
        </div>
      {:else if openMsg}
        <article class="message" in:fly={{ x: 12, duration: 180 }}>
          <div class="reader-top">
            <button class="btn ghost backbtn" on:click={closeMessage} aria-label="Back to inbox">
              <i class="ti ti-arrow-left"></i> Inbox
            </button>
          </div>
          <h2 class="msg-subject">{openMsg.subject}</h2>
          <div class="meta">
            <div><span class="meta-k">From</span> {openMsg.from}</div>
            {#if openMsg.to}<div><span class="meta-k">To</span> {openMsg.to}</div>{/if}
            {#if openMsg.date}<div><span class="meta-k">Date</span> {fullDate(openMsg.date)}</div>{/if}
          </div>
          <div class="body">
            {#if openMsg.text}
              <pre class="body-text">{openMsg.text}</pre>
            {:else if openMsg.safeHtml}
              <div class="body-html">{@html openMsg.safeHtml}</div>
            {:else}
              <div class="empty">This message has no readable content.</div>
            {/if}
          </div>
          <div class="replybox">
            <label class="field">
              <span>Reply</span>
              <textarea bind:value={replyText} rows="4" placeholder="Write a reply…" aria-label="Reply body"></textarea>
            </label>
            {#if replyNotice}<p class="notice safe" in:fly={{ y: 6, duration: 150 }}><i class="ti ti-check"></i> {replyNotice}</p>{/if}
            {#if replyError}<p class="notice danger" in:fly={{ y: 6, duration: 150 }}>{replyError}</p>{/if}
            <div class="actions">
              <button class="btn primary" on:click={sendReply} disabled={replying || !replyText.trim() || !openMsg.threadId} aria-label="Send reply">
                {#if replying}<span class="spin"></span>{:else}<i class="ti ti-send"></i>{/if} Reply
              </button>
            </div>
          </div>
        </article>
      {:else}
        <div class="empty pick">Select a message to read it.</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .mail { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .toolbar {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .search {
    flex: 1; display: flex; align-items: center; gap: 8px;
    background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 8px 12px; min-width: 0;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .search i { color: var(--text-3); font-size: 15px; }
  .search input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; min-width: 0; }
  .iconbtn { padding: 9px 12px; }

  .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: 340px 1fr; }

  /* ── List ── */
  .list { border-right: 1px solid var(--border); overflow-y: auto; min-height: 0; }
  .row {
    display: block; width: 100%; text-align: left;
    padding: 12px 16px; border-bottom: 1px solid var(--divider);
    cursor: pointer;
    transition: background var(--t-fast);
  }
  .row:hover { background: var(--s1); }
  .row.active { background: var(--accent-bg); }
  .row-top { display: flex; align-items: baseline; gap: 8px; }
  .from {
    flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text-2);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .when { font-size: 11px; color: var(--text-3); flex-shrink: 0; }
  .subj {
    font-size: 13.5px; font-weight: 400; color: var(--text); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row.unread .subj { font-weight: 500; }
  .row.unread .from { font-weight: 500; color: var(--text); }
  .snip {
    font-size: 12px; color: var(--text-3); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* ── Reader ── */
  .reader { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .reader-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .reader-top h2 { margin: 0; font-size: 16px; }
  .backbtn { padding: 6px 12px; display: none; }

  .message, .compose { padding: 18px 24px 32px; display: flex; flex-direction: column; }
  .compose { gap: 12px; }
  .compose .grow textarea { resize: vertical; }

  .msg-subject { margin: 0 0 10px; font-size: 18px; font-weight: 650; color: var(--text); }
  .meta {
    font-size: 12.5px; color: var(--text-2);
    display: flex; flex-direction: column; gap: 2px;
    padding-bottom: 12px; border-bottom: 1px solid var(--divider); margin-bottom: 14px;
  }
  .meta-k {
    display: inline-block; width: 40px; color: var(--text-3);
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .body { flex: 1; }
  .body-text {
    margin: 0; font: inherit; font-size: 14px; color: var(--text);
    white-space: pre-wrap; word-break: break-word;
  }
  .body-html { font-size: 14px; color: var(--text); overflow-x: auto; }
  .body-html :global(img) { max-width: 100%; height: auto; }
  .body-html :global(table) { max-width: 100%; }
  .body-html :global(a) { color: var(--accent-ink); }

  .replybox { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 10px; }
  .replybox textarea { resize: vertical; }
  .actions { display: flex; gap: 10px; align-items: center; }

  .notice { margin: 0; font-size: 13px; display: flex; align-items: center; gap: 6px; }
  .notice.safe { color: var(--safe); }
  .notice.danger { color: var(--danger); }

  .state {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; padding: 40px 20px; color: var(--text-3); font-size: 13.5px;
  }
  .state.error p { margin: 0; color: var(--danger); }
  .state :global(.spin) { flex-shrink: 0; }
  .pick { margin: auto; }

  /* ── Narrow: single pane, back button ── */
  @media (max-width: 760px) {
    .panes { grid-template-columns: 1fr; }
    .list { border-right: none; }
    .panes.opened .list { display: none; }
    .panes:not(.opened) .reader { display: none; }
    .backbtn { display: inline-flex; }
  }
  @media (min-width: 761px) {
    .compose .backbtn { display: none; }
  }
</style>
