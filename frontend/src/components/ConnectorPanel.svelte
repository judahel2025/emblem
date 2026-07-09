<script>
  // An in-chat connector mini-workspace: previews a connected app and lets you act
  // on it without leaving the conversation. Reads run free (with auto-retry); writes
  // pause on an inline approval card. "Expand" opens the full workspace.
  import { fly } from "svelte/transition";
  import { runConnected, hasWorkspace } from "../lib/workspaces.js";
  import { appView, notify } from "../lib/store.js";
  import { brandLogo, logoUrl, MONO_LOGOS } from "../lib/logos.js";
  import ApprovalCard from "./ApprovalCard.svelte";

  export let app;                 // gmail | googlecalendar | github | …
  export let view = "";           // optional focus
  export let params = {};

  const LABEL = { gmail: "Gmail", googlecalendar: "Calendar", github: "GitHub",
                  linkedin: "LinkedIn", twitter: "X", instagram: "Instagram",
                  facebook: "Facebook", notion: "Notion", slack: "Slack" };
  const label = LABEL[app] || app;

  let open = true;
  let loading = false, error = "";
  let items = [];
  let openItem = null, openLoading = false;
  let replyText = "", acting = false;
  let twitterHandle = "", twitterUserId = "";

  // Compose (calendar quick-add / gmail compose)
  let composeOpen = false, cTitle = "", cWhen = "", cTo = "", cSubject = "", cBody = "";

  // Inline approval surface
  let pendingApproval = null;
  function onApproval(info) {
    pendingApproval = {
      ...info,
      approve: async () => { const p = pendingApproval; pendingApproval = null; await p.__a(); },
      decline: async () => { const p = pendingApproval; pendingApproval = null; await p.__d(); },
      __a: info.approve, __d: info.decline,
    };
  }
  function imgFallback(e) { e.currentTarget.style.display = "none"; const i = e.currentTarget.nextElementSibling; if (i) i.style.display = ""; }

  // ── data helpers ──
  const asArr = (r) => Array.isArray(r) ? r : (r?.messages ?? r?.items ?? r?.events ?? r?.data?.messages ?? r?.data ?? []);
  const arr = (r) => { const a = asArr(r); return Array.isArray(a) ? a : []; };
  const senderName = (s) => { const t = String(s||"").trim(); const m = t.match(/^"?([^"<]*?)"?\s*</); return (m&&m[1].trim())||t.replace(/[<>]/g,"")||"Unknown"; };
  const emailOf = (s) => (String(s||"").match(/<([^>]+)>/)?.[1]) || String(s||"").trim();

  async function load() {
    loading = true; error = ""; openItem = null; composeOpen = false;
    try {
      if (app === "gmail") {
        const q = view === "unread" ? "is:unread in:inbox" : "in:inbox";
        items = arr(await runConnected("GMAIL_FETCH_EMAILS", { query: q, max_results: 8 }));
      } else if (app === "googlecalendar") {
        const end = new Date(); end.setDate(end.getDate() + 7);
        items = arr(await runConnected("GOOGLECALENDAR_EVENTS_LIST", {
          timeMin: new Date().toISOString(), timeMax: end.toISOString(),
          maxResults: 10, singleEvents: true, orderBy: "startTime" }));
      } else if (app === "instagram") {
        items = arr(await runConnected("INSTAGRAM_GET_USER_MEDIA", {}));
      } else if (app === "twitter" && twitterUserId) {
        items = arr(await runConnected("TWITTER_GET_USER_TWEETS_BY_ID", { id: twitterUserId, max_results: 8 }));
      }
    } catch (e) { error = e?.message || "Couldn't load."; }
    loading = false;
  }
  load();

  async function loadTwitter() {
    if (!twitterHandle.trim()) return;
    loading = true; error = ""; openItem = null; composeOpen = false;
    try {
      const username = twitterHandle.replace("@", "").trim();
      const userRes = await runConnected("TWITTER_GET_USER_ID_BY_USERNAME", { username });
      const uid = userRes?.id || userRes?.data?.id;
      if (uid) {
        twitterUserId = uid;
        const tweetsRes = await runConnected("TWITTER_GET_USER_TWEETS_BY_ID", { id: uid, max_results: 8 });
        items = arr(tweetsRes);
      } else {
        error = "User not found or API rejected.";
      }
    } catch (e) {
      error = e?.message || "Couldn't load tweets.";
    }
    loading = false;
  }

  async function postTweet() {
    if (!cBody.trim() || acting) return;
    acting = true;
    try {
      await runConnected("TWITTER_CREATION_OF_A_POST",
        { text: cBody.trim() },
        { act: true, onApproval });
      notify("Tweet posted", "safe"); cBody = ""; composeOpen = false; if (twitterUserId) loadTwitter();
    } catch (e) { if (e?.message !== "Declined.") notify(e?.message || "Couldn't post tweet", "danger"); }
    acting = false;
  }

  async function postInstagram() {
    if (!cTitle.trim() || acting) return;
    acting = true;
    try {
      await runConnected("INSTAGRAM_CREATE_POST",
        { image_url: cTitle.trim(), caption: cBody.trim() },
        { act: true, onApproval });
      notify("Instagram post created", "safe"); cTitle = ""; cBody = ""; composeOpen = false; load();
    } catch (e) { if (e?.message !== "Declined.") notify(e?.message || "Couldn't create Instagram post", "danger"); }
    acting = false;
  }

  async function openMail(m) {
    openLoading = true; replyText = "";
    try {
      const id = m.messageId || m.id;
      const r = await runConnected("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", { message_id: id, format: "full" });
      openItem = { ...m, ...(r || {}), _id: id, threadId: m.threadId || r?.threadId };
    } catch (e) { notify("Couldn't open the message", "danger"); }
    openLoading = false;
  }
  async function sendReply() {
    if (!replyText.trim() || acting) return;
    acting = true;
    try {
      await runConnected("GMAIL_REPLY_TO_THREAD",
        { thread_id: openItem.threadId, message_body: replyText.trim(), recipient_email: emailOf(openItem.sender || openItem.from) },
        { act: true, onApproval });
      notify("Reply sent", "safe"); replyText = ""; openItem = null; load();
    } catch (e) { if (e?.message !== "Declined.") notify(e?.message || "Reply failed", "danger"); }
    acting = false;
  }
  async function addEvent() {
    if (!cTitle.trim() || !cWhen || acting) return;
    acting = true;
    try {
      const start = new Date(cWhen).toISOString();
      // Proven GOOGLECALENDAR_CREATE_EVENT shape (matches GcalWorkspace).
      await runConnected("GOOGLECALENDAR_CREATE_EVENT",
        { calendar_id: "primary", summary: cTitle.trim(), start_datetime: start,
          event_duration_hour: 1, event_duration_minutes: 0 },
        { act: true, onApproval });
      notify("Event added", "safe"); cTitle = ""; cWhen = ""; composeOpen = false; load();
    } catch (e) { if (e?.message !== "Declined.") notify(e?.message || "Couldn't add event", "danger"); }
    acting = false;
  }

  function fmtEvent(e) {
    const s = e.start?.dateTime || e.start?.date || "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
</script>

<div class="panel glass gloss" transition:fly={{ y: 8, duration: 200 }}>
  <div class="p-head">
    <span class="p-ic" class:mono={MONO_LOGOS.has(app)}>
      {#if brandLogo(app)}{@html brandLogo(app)}
      {:else}<img class="p-img" src={logoUrl(app)} alt={label} on:error={imgFallback} /><i class="ti ti-plug" style="display:none"></i>{/if}
    </span>
    <span class="p-title">{label}{#if view === 'unread'} · unread{/if}</span>
    <span class="grow"></span>
    <button class="p-ib" on:click={load} disabled={loading} title="Refresh"><i class="ti ti-refresh"></i></button>
    {#if hasWorkspace(app)}
      <button class="p-ib" on:click={() => appView.set(`workspace:${app}`)} title="Open full workspace"><i class="ti ti-arrows-diagonal"></i></button>
    {/if}
    <button class="p-ib" on:click={() => open = !open} title={open ? "Collapse" : "Expand"}><i class="ti {open ? 'ti-chevron-up' : 'ti-chevron-down'}"></i></button>
  </div>

  {#if open}
    <div class="p-body">
      {#if loading}
        <div class="p-state"><span class="spin"></span> Loading your {label}…</div>
      {:else if error}
        <div class="p-state err">{error} <button class="link" on:click={load}>Retry</button></div>

      {:else if app === 'gmail'}
        {#if openItem}
          <div class="mail-open" in:fly={{ y: 6, duration: 150 }}>
            <button class="link back" on:click={() => openItem = null}><i class="ti ti-arrow-left"></i> Inbox</button>
            <p class="mo-from"><b>{senderName(openItem.sender || openItem.from)}</b></p>
            <p class="mo-subj">{openItem.subject || '(no subject)'}</p>
            <p class="mo-body">{(openItem.messageText || openItem.preview?.body || openItem.snippet || '').slice(0, 600)}</p>
            <textarea class="reply" bind:value={replyText} rows="3" placeholder="Write a reply…"></textarea>
            <button class="btn primary sm" on:click={sendReply} disabled={!replyText.trim() || acting}>
              {acting ? "Sending…" : "Send reply"}
            </button>
          </div>
        {:else if items.length}
          <ul class="rows">
            {#each items as m (m.messageId || m.id)}
              <li><button class="row" on:click={() => openMail(m)}>
                <span class="r-from">{senderName(m.sender || m.from)}</span>
                <span class="r-subj">{m.subject || '(no subject)'}</span>
              </button></li>
            {/each}
          </ul>
        {:else}<div class="p-state">No messages.</div>{/if}

      {:else if app === 'googlecalendar'}
        {#if composeOpen}
          <div class="compose" in:fly={{ y: 6, duration: 150 }}>
            <input bind:value={cTitle} placeholder="Event title" />
            <input type="datetime-local" bind:value={cWhen} />
            <div class="c-btns">
              <button class="btn primary sm" on:click={addEvent} disabled={!cTitle.trim() || !cWhen || acting}>{acting ? "Adding…" : "Add event"}</button>
              <button class="btn ghost sm" on:click={() => composeOpen = false}>Cancel</button>
            </div>
          </div>
        {:else}
          {#if items.length}
            <ul class="rows">
              {#each items as e (e.id)}
                <li><div class="row static">
                  <span class="r-from">{e.summary || '(untitled)'}</span>
                  <span class="r-subj">{fmtEvent(e)}</span>
                </div></li>
              {/each}
            </ul>
          {:else}<div class="p-state">Nothing on your calendar this week.</div>{/if}
          <button class="btn primary sm addbtn" on:click={() => composeOpen = true}><i class="ti ti-plus"></i> Quick add</button>
        {/if}

      {:else if app === 'twitter'}
        {#if composeOpen}
          <div class="compose" in:fly={{ y: 6, duration: 150 }}>
            <textarea class="reply" bind:value={cBody} rows="3" placeholder="What's happening?"></textarea>
            <div class="c-btns">
              <button class="btn primary sm" on:click={postTweet} disabled={!cBody.trim() || acting}>{acting ? "Posting…" : "Post"}</button>
              <button class="btn ghost sm" on:click={() => composeOpen = false}>Cancel</button>
            </div>
          </div>
        {:else}
          <div class="handle-input-row">
            <input bind:value={twitterHandle} placeholder="Enter username (e.g. Twitter)" on:keydown={(e) => e.key === 'Enter' && loadTwitter()} />
            <button class="btn primary sm" on:click={loadTwitter} disabled={loading}>Load</button>
          </div>
          {#if items.length}
            <ul class="rows" style="margin-top: 8px;">
              {#each items as t (t.id)}
                <li><div class="row static">
                  <span class="r-from">@{twitterHandle}</span>
                  <span class="r-subj">{t.text || ''}</span>
                </div></li>
              {/each}
            </ul>
          {:else}<div class="p-state">No tweets loaded.</div>{/if}
          <button class="btn primary sm addbtn" on:click={() => { composeOpen = true; cBody = ""; }}><i class="ti ti-plus"></i> Post tweet</button>
        {/if}

      {:else if app === 'instagram'}
        {#if composeOpen}
          <div class="compose" in:fly={{ y: 6, duration: 150 }}>
            <input bind:value={cTitle} placeholder="Image URL" />
            <textarea class="reply" bind:value={cBody} rows="3" placeholder="Caption…"></textarea>
            <div class="c-btns">
              <button class="btn primary sm" on:click={postInstagram} disabled={!cTitle.trim() || acting}>{acting ? "Posting…" : "Post"}</button>
              <button class="btn ghost sm" on:click={() => composeOpen = false}>Cancel</button>
            </div>
          </div>
        {:else}
          {#if items.length}
            <ul class="rows">
              {#each items as item (item.id)}
                <li><div class="row static">
                  {#if item.media_url || item.thumbnail_url}
                    <img src={item.media_url || item.thumbnail_url} alt="Instagram Media" class="ig-thumb" style="width: 100%; max-height: 150px; object-fit: cover; border-radius: var(--r-sm); margin-bottom: 4px;" />
                  {/if}
                  <span class="r-subj">{item.caption || '(no caption)'}</span>
                </div></li>
              {/each}
            </ul>
          {:else}<div class="p-state">No posts.</div>{/if}
          <button class="btn primary sm addbtn" on:click={() => { composeOpen = true; cTitle = ""; cBody = ""; }}><i class="ti ti-plus"></i> Post photo</button>
        {/if}

      {:else}
        <div class="p-state">
          Open the full {label} workspace to work with it.
          {#if hasWorkspace(app)}<button class="btn primary sm" on:click={() => appView.set(`workspace:${app}`)}>Open {label}</button>{/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if pendingApproval}
    <div class="p-approval">
      <ApprovalCard approval={{ id: pendingApproval.approval_id, summary: pendingApproval.summary, args_json: pendingApproval.args_json }}
        variant="inline" onApprove={pendingApproval.approve} onDecline={pendingApproval.decline} />
    </div>
  {/if}
</div>

<style>
  .panel { width: 100%; max-width: 520px; border-radius: var(--r-lg); box-shadow: var(--shadow-md); overflow: hidden; }
  .p-head { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
  .p-ic { width: 28px; height: 28px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--s2); flex-shrink: 0; }
  .p-ic :global(svg) { width: 18px; height: 18px; } .p-ic .p-img { width: 18px; height: 18px; object-fit: contain; }
  .p-ic.mono :global(svg) { color: var(--text); }
  .p-title { font-size: 13.5px; font-weight: 500; color: var(--text); }
  .grow { flex: 1; }
  .p-ib { width: 28px; height: 28px; border-radius: var(--r-sm); display: grid; place-items: center; color: var(--text-3); font-size: 15px;
    transition: color var(--t-fast), background var(--t-fast); }
  .p-ib:hover { color: var(--text); background: var(--s2); }
  .p-body { padding: 8px; max-height: 320px; overflow-y: auto; }
  .p-state { padding: 20px 12px; text-align: center; color: var(--text-3); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .p-state.err { color: var(--danger); }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left; padding: 8px 10px; border-radius: var(--r-sm); cursor: pointer;
    transition: background var(--t-fast); }
  .row:not(.static):hover { background: var(--s2); }
  .row.static { cursor: default; }
  .r-from { font-size: 13px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r-subj { font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail-open { padding: 6px 8px; display: flex; flex-direction: column; gap: 8px; }
  .back { align-self: flex-start; }
  .mo-from { margin: 0; font-size: 13px; color: var(--text); } .mo-subj { margin: 0; font-size: 13.5px; font-weight: 500; color: var(--text); }
  .mo-body { margin: 4px 0; font-size: 12.5px; line-height: 1.55; color: var(--text-2); white-space: pre-wrap; max-height: 130px; overflow-y: auto; }
  .reply, .compose input { width: 100%; background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-sm);
    padding: 8px 10px; font-size: 13px; color: var(--text); font-family: inherit; outline: none; }
  .reply:focus, .compose input:focus { border-color: var(--accent); }
  .compose { display: flex; flex-direction: column; gap: 8px; padding: 6px 8px; }
  .c-btns { display: flex; gap: 8px; }
  .btn.sm { padding: 7px 14px; font-size: 13px; }
  .addbtn { margin: 8px 2px 2px; }
  .link { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 500; color: var(--accent-ink); cursor: pointer; }
  .p-approval { padding: 10px; border-top: 1px solid var(--border); }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--text-2); animation: spin 0.7s linear infinite; display: inline-block; }
  .handle-input-row { display: flex; gap: 8px; padding: 6px 8px; }
  .handle-input-row input { flex: 1; background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 7px 10px; font-size: 13px; color: var(--text); outline: none; }
  .handle-input-row input:focus { border-color: var(--accent); }
</style>
