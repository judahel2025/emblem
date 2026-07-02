<script>
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { notify } from "../lib/store.js";

  // --- outbound (drafts / sent) ---
  let drafts = [];
  let sending = null;

  // --- inbound (received) ---
  let received = [];
  let unread = 0;
  let openMsg = null;

  // --- shared ---
  let open = null;
  let filter = "draft";
  const filters = [
    ["received", "Received"],
    ["draft",    "Drafts"],
    ["sent",     "Sent"],
    ["archived", "Archived"],
    ["all",      "All Sent"],
  ];

  async function load() {
    if (filter === "received") {
      const r = await api.mailMessages("all", 100).catch(() => ({ items: [], unread: 0 }));
      received = r.items || [];
      unread   = r.unread || 0;
    } else {
      drafts = (await api.emails(filter).catch(() => ({ items: [] }))).items || [];
    }
  }

  async function refreshUnread() {
    const r = await api.mailMessages("unread", 1).catch(() => ({ unread: 0 }));
    unread = r.unread || 0;
  }

  let checking = false;
  async function checkNow() {
    checking = true;
    await api.inboxCheckNow().catch(() => {});
    // Give the backend ~1.5s to store and then reload
    await new Promise(r => setTimeout(r, 1500));
    await load();
    checking = false;
    notify("Inbox refreshed", "safe");
  }

  // Auto-poll the UI every 20s when Received tab is open
  let _pollTimer = null;
  function _startPoll() { _pollTimer = setInterval(() => { if (filter === "received") load(); }, 20000); }
  function _stopPoll()  { clearInterval(_pollTimer); _pollTimer = null; }

  onMount(() => { load(); refreshUnread(); _startPoll(); return _stopPoll; });

  function setFilter(f) { filter = f; open = null; openMsg = null; load(); }

  // --- outbound actions ---
  async function send(d) {
    sending = d.id;
    const r = await api.emailSend(d.id).catch(() => ({ ok: false }));
    sending = null;
    if (r.ok) { notify(`Sent to ${d.recipient} ✓`, "safe"); load(); }
    else notify(r.error || "Couldn't send", "danger");
  }
  async function archiveDraft(d) { await api.emailArchive(d.id); notify("Archived", "caution"); load(); }
  async function restore(d)      { await api.emailRestore(d.id); notify("Restored to drafts", "safe"); load(); }
  async function remove(d) {
    if (!confirm(`Delete this email${d.recipient ? ` to ${d.recipient}` : ""}?`)) return;
    await api.emailDelete(d.id); notify("Deleted", "danger"); load();
  }

  // --- inbound actions ---
  async function openReceived(m) {
    openMsg = openMsg?.id === m.id ? null : m;
    if (openMsg && m.status === "unread") {
      await api.mailMarkRead(m.id);
      m.status = "read";
      received = received;
      unread = Math.max(0, unread - 1);
    }
  }
  async function archiveMail(m) {
    await api.mailArchive(m.id);
    notify("Archived", "caution");
    load();
    if (openMsg?.id === m.id) openMsg = null;
  }
  let suggesting = null;
  async function suggestReply(m) {
    suggesting = m.id;
    const r = await api.mailSuggestReply(m.id).catch(() => ({ ok: false }));
    suggesting = null;
    if (!r.ok) { notify("Couldn't generate reply — is the AI brain connected?", "danger"); return; }
    await api.emailDraft(r.to, r.subject, r.reply).catch(() => {});
    notify("Reply drafted — check your Drafts tab", "safe");
    setFilter("draft");
  }
  async function replyTo(m) {
    notify(`Say: "Veyra, reply to ${m.from_addr} about…"`, "safe");
  }

  // --- delete all ---
  let showDeleteModal = false;
  let deleting = false;
  let undoTimer = null;
  let undoSecondsLeft = 0;

  function openDeleteModal() { showDeleteModal = true; }
  function closeDeleteModal() { showDeleteModal = false; }

  function trapFocus(node) {
    const focusable = () => [...node.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')];
    function onKey(e) {
      if (e.key !== "Tab") return;
      const els = focusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    function onEsc(e) { if (e.key === "Escape") closeDeleteModal(); }
    node.addEventListener("keydown", onKey);
    node.addEventListener("keydown", onEsc);
    focusable()[0]?.focus();
    return { destroy() { node.removeEventListener("keydown", onKey); node.removeEventListener("keydown", onEsc); } };
  }

  async function confirmDeleteAll() {
    deleting = true;
    const r = await api.inboxDeleteAll().catch(() => ({ ok: false, deletedCount: 0 }));
    deleting = false;
    closeDeleteModal();
    if (!r.ok && r.deletedCount === undefined) {
      notify("Delete failed — try again", "danger");
      return;
    }
    const count = r.deletedCount ?? 0;
    received = [];
    unread = 0;
    // Undo toast countdown
    undoSecondsLeft = 30;
    clearInterval(undoTimer);
    undoTimer = setInterval(() => {
      undoSecondsLeft -= 1;
      if (undoSecondsLeft <= 0) { clearInterval(undoTimer); undoTimer = null; undoSecondsLeft = 0; }
    }, 1000);
    notify(`Inbox cleared — ${count} message${count === 1 ? "" : "s"} deleted`, "caution");
  }

  async function undoDelete() {
    clearInterval(undoTimer); undoTimer = null; undoSecondsLeft = 0;
    const r = await api.inboxUndo().catch(() => ({ ok: false }));
    if (r.ok) { notify(`Restored ${r.restoredCount} messages`, "safe"); load(); }
    else notify("Undo window expired", "danger");
  }

  // --- formatting helpers ---
  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 86400 && d.getDate() === now.getDate())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function stripHtml(html) {
    return (html || "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  }
  function cleanText(m) {
    const t = (m.text_body || "").replace(/^\[untrusted\]\s*/i, "").trim();
    if (t) return t;
    return stripHtml(m.html_body || "");
  }
  function bodyPreview(m) { return cleanText(m).slice(0, 120); }
</script>

<!-- ── CONFIRMATION MODAL ── -->
{#if showDeleteModal}
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal" use:trapFocus>
      <h4 id="modal-title">Confirm Bulk Delete</h4>
      <p>
        You are about to permanently delete
        <strong>{received.length} message{received.length === 1 ? "" : "s"}</strong>.
        This action cannot be undone.
      </p>
      <div class="modal-actions">
        <button class="btn-cancel" on:click={closeDeleteModal} disabled={deleting}>Cancel</button>
        <button class="btn-delete-confirm" on:click={confirmDeleteAll} disabled={deleting}>
          {#if deleting}<span class="spin"></span>{:else}<i class="ti ti-trash"></i>{/if}
          Delete
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── UNDO BANNER ── -->
{#if undoSecondsLeft > 0}
  <div class="undo-bar">
    <span>Inbox cleared.</span>
    <button class="undo-btn" on:click={undoDelete}>
      <i class="ti ti-arrow-back-up"></i> Undo ({undoSecondsLeft}s)
    </button>
  </div>
{/if}

<div class="head">
  <div>
    <h3>Inbox</h3>
    <p class="muted">Received mail + outbound drafts. Tell Veyra "write an email to…" to create a draft.</p>
  </div>
  <div class="toolbar">
    <button class="badge accent conn" on:click={checkNow} disabled={checking}>
      <i class="ti ti-{checking ? 'loader-2' : 'refresh'}"></i> {checking ? "Checking…" : "Check Now"}
    </button>
    <div class="tooltip-wrap">
      <button
        class="btn-delete-all"
        on:click={openDeleteModal}
        tabindex="0"
        aria-label="Delete all inbox messages"
      >
        <i class="ti ti-trash"></i> Delete All
      </button>
      <span class="tooltip">Permanently delete every message in the inbox.</span>
    </div>
  </div>
</div>

<div class="filters">
  {#each filters as [val, lbl]}
    <button class:on={filter === val} on:click={() => setFilter(val)}>
      {lbl}
      {#if val === "received" && unread > 0}
        <span class="ubadge">{unread}</span>
      {/if}
    </button>
  {/each}
</div>

<!-- ── RECEIVED ── -->
{#if filter === "received"}
  <div class="head2">
    <h4>Received</h4>
    <span class="badge {received.length ? 'safe' : 'caution'}">{received.length}</span>
    {#if unread > 0}<span class="badge accent">{unread} unread</span>{/if}
  </div>

  {#if received.length}
    <div class="card list">
      {#each received as m (m.id)}
        <div class="draft {m.status === 'unread' ? 'unread-row' : ''}"
             on:click={() => openReceived(m)}>
          <i class="ti ti-mail{m.status === 'unread' ? '' : '-opened'}"
             style="color:{m.status === 'unread' ? 'var(--accent)' : 'var(--text-3)'}"></i>
          <div class="dmeta">
            <span class="dsub">{m.subject || "(no subject)"}</span>
            <span class="muted dto">from {m.from_addr} · {fmtDate(m.received_at || m.created_at)}</span>
            {#if openMsg?.id !== m.id}
              <span class="preview muted">{bodyPreview(m)}</span>
            {/if}
          </div>
          <span class="badge {m.status === 'unread' ? 'accent' : m.status === 'archived' ? 'caution' : ''}"
                style="{m.status === 'read' ? 'opacity:0.4' : ''}">{m.status}</span>
        </div>
        {#if openMsg?.id === m.id}
          <div class="msgbody">
            <div class="msg-meta">
              <span><strong>From:</strong> {m.from_addr}</span>
              <span><strong>To:</strong> {m.to_addr}</span>
              <span><strong>Subject:</strong> {m.subject || "(no subject)"}</span>
            </div>
            {#if cleanText(openMsg)}
              <pre class="dbody">{cleanText(openMsg)}</pre>
            {:else if openMsg?.html_body}
              <div class="dbody htmlbody">{@html openMsg.html_body}</div>
            {:else}
              <div class="dbody empty-body">
                <i class="ti ti-mail-exclamation"></i>
                Body not captured yet — Veyra will fetch it within 60 seconds automatically.
              </div>
            {/if}
            <div class="sendrow">
              <button class="sendbtn" on:click|stopPropagation={() => suggestReply(m)} disabled={suggesting === m.id}>
                {#if suggesting === m.id}
                  <span class="spin"></span> Generating…
                {:else}
                  <i class="ti ti-sparkles"></i> Suggest reply
                {/if}
              </button>
              <button class="actbtn" on:click|stopPropagation={() => replyTo(m)}>
                <i class="ti ti-corner-up-left"></i> Reply hint
              </button>
              <button class="actbtn" on:click|stopPropagation={() => archiveMail(m)}>
                <i class="ti ti-archive"></i> Archive
              </button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="card empty">
      No received mail yet. Send an email to <code>veyra@veyra.thequaniac.com</code> and it will appear here.
    </div>
  {/if}

<!-- ── DRAFTS / SENT / ALL ── -->
{:else}
  <div class="head2">
    <h4>{filters.find((f) => f[0] === filter)?.[1]}</h4>
    <span class="badge {drafts.length ? 'safe' : 'caution'}">{drafts.length}</span>
  </div>

  {#if drafts.length}
    <div class="card list">
      {#each drafts as d (d.id)}
        <div class="draft" on:click={() => (open = open === d.id ? null : d.id)}>
          <i class="ti ti-mail-forward"></i>
          <div class="dmeta">
            <span class="dsub">{d.subject || "(no subject)"}</span>
            <span class="muted dto">to {d.recipient || "—"} · {d.created_at}</span>
          </div>
          <span class="badge {d.status === 'sent' ? 'safe' : d.status === 'archived' ? 'caution' : 'accent'}">{d.status}</span>
        </div>
        {#if open === d.id}
          <pre class="dbody">{d.body}</pre>
          <div class="sendrow">
            {#if d.status === "draft" && d.recipient}
              <button class="sendbtn" on:click|stopPropagation={() => send(d)} disabled={sending === d.id}>
                <i class="ti ti-send"></i> {sending === d.id ? "Sending…" : `Send to ${d.recipient}`}
              </button>
            {/if}
            {#if d.status !== "archived"}
              <button class="actbtn" on:click|stopPropagation={() => archiveDraft(d)}>
                <i class="ti ti-archive"></i> Archive
              </button>
            {:else}
              <button class="actbtn" on:click|stopPropagation={() => restore(d)}>
                <i class="ti ti-arrow-back-up"></i> Restore
              </button>
            {/if}
            <button class="actbtn danger" on:click|stopPropagation={() => remove(d)}>
              <i class="ti ti-trash"></i> Delete
            </button>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="card empty">Nothing here. Say: "Veyra, write an email to my client about the invoice."</div>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .head h3 { margin: 0 0 2px; font-size: 16px; } .head p { margin: 0; font-size: 13px; }
  .toolbar { display: flex; align-items: center; gap: 8px; }
  .conn { border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
  .head2 { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .head2 h4 { margin: 0; font-size: 14px; }

  /* Delete All button */
  .tooltip-wrap { position: relative; display: inline-flex; }
  .btn-delete-all { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px;
                    border-radius: 9px; font-size: 12.5px; color: var(--danger, #dc2626);
                    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 35%, transparent);
                    background: color-mix(in srgb, var(--danger, #dc2626) 8%, transparent);
                    cursor: pointer; transition: background 0.15s; }
  .btn-delete-all:hover { background: color-mix(in srgb, var(--danger, #dc2626) 18%, transparent); }
  .btn-delete-all i { font-size: 14px; }
  .tooltip { position: absolute; top: calc(100% + 6px); right: 0; white-space: nowrap;
             background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 8px;
             padding: 6px 10px; font-size: 12px; color: var(--text-2); pointer-events: none;
             opacity: 0; transition: opacity 0.15s; z-index: 20; }
  .tooltip-wrap:hover .tooltip, .tooltip-wrap:focus-within .tooltip { opacity: 1; }

  /* Modal */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex;
                    align-items: center; justify-content: center; z-index: 100; }
  .modal { background: var(--bg-1); border: 1px solid var(--line-2); border-radius: 16px;
           padding: 28px 30px; max-width: 400px; width: 90%; display: flex;
           flex-direction: column; gap: 16px; }
  .modal h4 { margin: 0; font-size: 17px; color: var(--text); }
  .modal p { margin: 0; font-size: 14px; color: var(--text-2); line-height: 1.6; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .btn-cancel { padding: 9px 20px; border-radius: 9px; font-size: 13px; font-weight: 500;
               background: var(--bg-3); color: var(--text-2); border: 1px solid var(--line); cursor: pointer; }
  .btn-cancel:hover { background: var(--bg-2); }
  .btn-delete-confirm { display: inline-flex; align-items: center; gap: 7px; padding: 9px 20px;
                        border-radius: 9px; font-size: 13px; font-weight: 600;
                        background: #dc2626; color: #fff; border: none; cursor: pointer; }
  .btn-delete-confirm:hover { background: #b91c1c; }
  .btn-delete-confirm:disabled, .btn-cancel:disabled { opacity: 0.55; cursor: default; }

  /* Undo banner */
  .undo-bar { display: flex; align-items: center; justify-content: space-between;
              background: color-mix(in srgb, var(--accent-bg) 60%, transparent);
              border: 1px solid var(--accent); border-radius: 10px;
              padding: 10px 16px; margin-bottom: 12px; font-size: 13px; color: var(--text-2); }
  .undo-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px;
              border-radius: 8px; font-size: 13px; font-weight: 600;
              background: var(--accent); color: #1a0e08; border: none; cursor: pointer; }
  .undo-btn:hover { filter: brightness(1.08); }

  .list { padding: 6px; }
  .draft { display: flex; align-items: flex-start; gap: 12px; padding: 11px 10px; border-radius: 8px; cursor: pointer; }
  .draft:hover { background: var(--bg-2); }
  .draft > i { font-size: 18px; margin-top: 2px; }
  .unread-row { background: color-mix(in srgb, var(--accent-bg) 40%, transparent); }
  .dmeta { flex: 1; display: flex; flex-direction: column; min-width: 0; gap: 2px; }
  .dsub { font-weight: 500; }
  .dto { font-size: 12px; }
  .preview { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .filters { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .filters button { position: relative; padding: 6px 14px; border-radius: 999px; font-size: 12.5px;
                    color: var(--text-2); border: 1px solid var(--line); background: var(--bg-1); }
  .filters button.on { background: var(--accent-bg); color: var(--accent-2); border-color: var(--accent); }
  .ubadge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; border-radius: 999px;
            background: var(--accent); color: #1a0e08; font-size: 10px; font-weight: 700;
            display: flex; align-items: center; justify-content: center; padding: 0 4px; }
  .dbody { margin: 0 10px 8px; padding: 12px 14px; background: var(--bg-2); border-radius: 8px;
           font-family: ui-monospace, monospace; font-size: 13px; white-space: pre-wrap; line-height: 1.6; }
  .msgbody { margin: 0 10px 10px; }
  .msg-meta { display: flex; flex-direction: column; gap: 3px; padding: 8px 14px;
              background: var(--bg-2); border-radius: 8px 8px 0 0; font-size: 12.5px;
              border-bottom: 1px solid var(--line); }
  .msgbody .dbody { border-radius: 0 0 8px 8px; margin: 0; }
  .sendrow { margin: 8px 0 4px; display: flex; flex-wrap: wrap; gap: 8px; }
  .sendbtn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: 9px;
             background: var(--accent); color: #1a0e08; font-weight: 600; font-size: 13px; }
  .sendbtn:hover { filter: brightness(1.06); }
  .sendbtn:disabled { opacity: 0.6; }
  .actbtn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 9px;
            font-size: 13px; color: var(--text-2); border: 1px solid var(--line); }
  .actbtn:hover { background: var(--bg-2); color: var(--text); }
  .actbtn.danger:hover { color: var(--danger, #dc2626); border-color: var(--danger, #dc2626); }
  .empty { padding: 20px; color: var(--text-2); font-size: 13px; line-height: 1.7; }
  code { background: var(--bg-2); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  .htmlbody { white-space: normal; font-family: inherit; font-size: 14px; line-height: 1.6; }
  .empty-body { color: var(--text-3); font-size: 13px; display: flex; align-items: flex-start; gap: 8px; font-family: inherit; }
  .empty-body i { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
</style>
