<script>
  // The admin console — owner only (the API 404s for everyone else; the client
  // guard in App.svelte is cosmetic). Three tabs: Users, Reviews, Newsletter.
  // The Newsletter tab is an AI channel: chat on the left, live preview on the
  // right, approve → send to every opted-in recipient.
  import { onMount, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { notify } from "../lib/store.js";

  let tab = "reviews";   // users | reviews | newsletter

  // ── Users ──
  let users = [];
  let usersLoaded = false;
  async function loadUsers() {
    try { users = (await api.adminUsers()).items || []; usersLoaded = true; }
    catch (e) { notify("Couldn't load users.", "danger"); }
  }

  // ── Reviews ──
  let reviews = [];
  let newCount = 0;
  let openReview = null;   // id of the expanded review
  let reviewsLoaded = false;
  async function loadReviews() {
    try {
      const r = await api.adminReviews();
      reviews = r.items || [];
      newCount = r.new_count || 0;
      reviewsLoaded = true;
    } catch (e) { notify("Couldn't load reviews.", "danger"); }
  }
  function toggleReview(r) {
    openReview = openReview === r.id ? null : r.id;
    if (openReview === r.id && r.status === "new") {
      r.status = "read"; reviews = reviews; newCount = Math.max(0, newCount - 1);
      api.adminReviewRead(r.id).catch(() => {});
    }
  }
  const transcriptOf = (r) => { try { return JSON.parse(r.transcript || "[]"); } catch { return []; } };

  // ── Newsletter ──
  let nlLines = [];               // {who, text}
  let nlDraft = "";               // composer text
  let nlBusy = false;
  let draft = { subject: "", html: "" };
  let editHtml = false;
  let domain = null;              // {configured, domain, status}
  let history = [];
  let recipients = null;          // {count, members, subscribers}
  let confirmSend = false;
  let sending = false;
  let sendResult = null;          // {sent, failed, results}
  let sentLocked = false;         // this issue went out; discussion is closed
  let nlLinesEl, nlInputEl;

  // A sent newsletter is done. Close the discussion and open a fresh window.
  function freshNewsletter() {
    nlLines = [];
    draft = { subject: "", html: "" };
    sendResult = null;
    sentLocked = false;
    editHtml = false;
    loadNewsletterMeta();
  }

  async function loadNewsletterMeta() {
    api.adminNewsDomain().then((d) => (domain = d)).catch(() => {});
    api.adminNewsHistory().then((h) => (history = h.items || [])).catch(() => {});
  }

  async function nlSend() {
    const t = nlDraft.trim();
    if (!t || nlBusy || sentLocked) return;
    nlDraft = "";
    nlLines = [...nlLines, { who: "user", text: t }];
    scrollNl();
    nlBusy = true;
    try {
      const hist = nlLines.map((l) => ({ role: l.who, text: l.text }));
      const r = await api.adminNewsChat(hist, draft.html ? draft : null);
      if (!r.ok) throw new Error(r.error || "unavailable");
      nlLines = [...nlLines, { who: "assistant", text: r.reply }];
      if (r.subject) draft.subject = r.subject;
      if (r.html) draft.html = r.html;
      draft = draft;
      scrollNl();
    } catch (e) {
      console.error("newsletter chat failed:", e);
      notify("Couldn't reach the editor — try again.", "danger");
    }
    nlBusy = false;
    await tick(); try { nlInputEl?.focus(); } catch {}
  }
  function scrollNl() {
    queueMicrotask(() => { if (nlLinesEl) nlLinesEl.scrollTop = nlLinesEl.scrollHeight; });
  }

  async function testSend() {
    if (!draft.subject || !draft.html) { notify("Draft a subject and body first.", "caution"); return; }
    sending = true;
    try {
      const r = await api.adminNewsTest(draft.subject, draft.html);
      if (r.ok) notify(`Test sent to ${r.to}.`, "safe");
      else notify(`Test failed: ${r.error}`, "danger");
    } catch { notify("Test send failed.", "danger"); }
    sending = false;
  }

  async function askSend() {
    if (!draft.subject || !draft.html) { notify("Draft a subject and body first.", "caution"); return; }
    recipients = null;
    confirmSend = true;
    try { recipients = await api.adminNewsRecipients(); }
    catch { recipients = { count: 0, members: 0, subscribers: 0 }; }
  }

  async function reallySend() {
    confirmSend = false;
    sending = true;
    sendResult = null;
    try {
      const r = await api.adminNewsSend(draft.subject, draft.html);
      sendResult = r;
      if (r.sent > 0 && r.failed === 0) notify(`Newsletter sent to ${r.sent} people.`, "safe");
      else if (r.sent > 0) notify(`Sent ${r.sent}, failed ${r.failed}. See results.`, "caution");
      else notify(`Send failed: ${r.results?.[0]?.error || "unknown error"}`, "danger");
      if (r.sent > 0) sentLocked = true;   // it's out — close this discussion
      loadNewsletterMeta();
    } catch (e) { notify("Send failed.", "danger"); }
    sending = false;
  }

  const fmtDate = (s) => { try { return new Date(s + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return s; } };

  onMount(() => { loadReviews(); loadUsers(); loadNewsletterMeta(); });
</script>

<div class="page">
  <header class="head reveal-in">
    <div>
      <h1>Admin console</h1>
      <p class="sub">Members, reviews, and newsletters — owner's eyes only.</p>
    </div>
  </header>

  <div class="tabs">
    <button class:on={tab === "users"} on:click={() => (tab = "users")}>
      <i class="ti ti-users"></i> Users {#if usersLoaded}<em>{users.length}</em>{/if}
    </button>
    <button class:on={tab === "reviews"} on:click={() => (tab = "reviews")}>
      <i class="ti ti-message-star"></i> Reviews {#if newCount}<em class="hot">{newCount}</em>{/if}
    </button>
    <button class:on={tab === "newsletter"} on:click={() => (tab = "newsletter")}>
      <i class="ti ti-mail-forward"></i> Newsletter
    </button>
  </div>

  {#if tab === "users"}
    <div class="card glass" in:fade={{ duration: 150 }}>
      {#if !usersLoaded}
        <div class="empty">Loading…</div>
      {:else if !users.length}
        <div class="empty">No members yet.</div>
      {:else}
        <div class="tablewrap">
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Joined</th><th>Onboarded</th><th>Newsletter</th></tr></thead>
            <tbody>
              {#each users as u}
                <tr>
                  <td class="mono">{u.email}</td>
                  <td>{u.display_name || "—"}</td>
                  <td class="dim2">{u.role || "—"}</td>
                  <td class="dim2">{fmtDate(u.created_at)}</td>
                  <td>{u.onboarded ? "✓" : "—"}</td>
                  <td>
                    {#if u.newsletter_opt === 1}<span class="chip in">in</span>
                    {:else if u.newsletter_opt === 0}<span class="chip out">out</span>
                    {:else}<span class="chip">—</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

  {:else if tab === "reviews"}
    <div class="rlist" in:fade={{ duration: 150 }}>
      {#if !reviewsLoaded}
        <div class="empty">Loading…</div>
      {:else if !reviews.length}
        <div class="empty">No reviews yet — they'll land here as members leave them.</div>
      {:else}
        {#each reviews as r (r.id)}
          <div class="rcard glass" class:unread={r.status === "new"}>
            <button class="rhead" on:click={() => toggleReview(r)}>
              {#if r.status === "new"}<span class="newdot" title="New"></span>{/if}
              <span class="rwho">{r.display_name || r.email || "member"}</span>
              <span class="rkind">{r.kind === "ai" ? "AI-guided" : "typed"}</span>
              {#if r.sentiment}
                <span class="chip {r.sentiment === 'positive' ? 'in' : r.sentiment === 'negative' ? 'out' : 'mid'}">{r.sentiment}</span>
              {/if}
              <span class="rdate">{fmtDate(r.created_at)}</span>
              <i class="ti {openReview === r.id ? 'ti-chevron-up' : 'ti-chevron-down'}"></i>
            </button>
            {#if openReview === r.id}
              <div class="rbody" transition:fly={{ y: -6, duration: 160 }}>
                <pre class="rsummary">{r.summary}</pre>
                {#if r.kind === "ai" && r.transcript}
                  <details class="rtrans">
                    <summary>Full conversation</summary>
                    {#each transcriptOf(r) as t}
                      <p class="tline {t.role}"><b>{t.role === "user" ? "Member" : "Emblem"}:</b> {t.text}</p>
                    {/each}
                  </details>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

  {:else}
    <!-- ── Newsletter: AI channel + live preview ── -->
    {#if domain}
      <div class="domain {domain.status}" in:fade={{ duration: 150 }}>
        {#if domain.status === "verified"}
          <i class="ti ti-circle-check"></i> Sending domain <b>{domain.domain}</b> is verified — real sends are live.
        {:else if domain.status === "missing" || domain.status === "unknown"}
          <i class="ti ti-alert-triangle"></i>
          <span>Sending domain <b>{domain.domain || "not set"}</b> isn't verified with Resend yet — sends will fail until it is.
          Add the domain in the Resend dashboard, then put its DKIM/SPF records into <b>Namecheap DNS</b>.</span>
        {:else}
          <i class="ti ti-clock"></i> Domain <b>{domain.domain}</b> is {domain.status} — waiting on DNS.
        {/if}
      </div>
    {/if}

    <div class="nlgrid" in:fade={{ duration: 150 }}>
      <div class="nlchat card glass">
        <div class="nlhead">Draft it with Emblem</div>
        <div class="nllines" bind:this={nlLinesEl}>
          {#if !nlLines.length}
            <p class="hint">Tell Emblem what this issue should cover — you'll go back and forth
              until it's right, then preview and approve.</p>
          {/if}
          {#each nlLines as l}
            <p class="line {l.who}">{l.text}</p>
          {/each}
          {#if nlBusy}<p class="line assistant dots"><span></span><span></span><span></span></p>{/if}
        </div>
        {#if sentLocked}
          <div class="sentlock" in:fade={{ duration: 150 }}>
            <i class="ti ti-circle-check"></i>
            <span>This newsletter went out{sendResult?.sent ? ` to ${sendResult.sent} people` : ""}. This discussion is closed.</span>
            <button class="freshb" on:click={freshNewsletter}>
              <i class="ti ti-plus"></i> Start a new newsletter
            </button>
          </div>
        {:else}
          <div class="composer">
            <input bind:value={nlDraft} bind:this={nlInputEl}
                   placeholder="e.g. announce the new voice mode and notes"
                   on:keydown={(e) => e.key === "Enter" && nlSend()} />
            <button class="send" on:click={nlSend} disabled={nlBusy} aria-label="Send">
              <i class="ti ti-arrow-up"></i>
            </button>
          </div>
        {/if}
      </div>

      <div class="nlpreview card glass">
        <div class="nlhead">
          Preview
          <button class="htoggle" on:click={() => (editHtml = !editHtml)}>
            <i class="ti {editHtml ? 'ti-eye' : 'ti-code'}"></i> {editHtml ? "Preview" : "Edit HTML"}
          </button>
        </div>
        <input class="subj" bind:value={draft.subject} placeholder="Subject line" aria-label="Subject" />
        {#if editHtml}
          <textarea class="htmlsrc" bind:value={draft.html} placeholder="Email HTML…"></textarea>
        {:else if draft.html}
          <iframe class="mailframe" title="Newsletter preview" sandbox="" srcdoc={draft.html}></iframe>
        {:else}
          <div class="empty">No draft yet — start the chat on the left.</div>
        {/if}
        <div class="sendbar">
          <button class="ghostb" on:click={testSend} disabled={sending || sentLocked || !draft.html}>
            <i class="ti ti-send"></i> Send test to me
          </button>
          <button class="primaryb" on:click={askSend} disabled={sending || sentLocked || !draft.html}>
            {sentLocked ? "Sent ✓" : sending ? "Sending…" : "Approve & send"}
          </button>
        </div>
        {#if sendResult}
          <div class="results" in:fade={{ duration: 150 }}>
            <b>{sendResult.sent} sent · {sendResult.failed} failed</b>
            {#if sendResult.failed > 0}
              {#each (sendResult.results || []).filter((x) => !x.ok).slice(0, 8) as f}
                <p class="fail">{f.to}: {f.error}</p>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if history.length}
      <div class="card glass hist">
        <div class="nlhead">Sent</div>
        {#each history as h}
          <div class="hrow">
            <span class="htitle">{h.subject}</span>
            <span class="dim2">{h.sent_count} sent{h.fail_count ? ` · ${h.fail_count} failed` : ""} · {fmtDate(h.created_at)}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if confirmSend}
  <div class="veil" on:click|self={() => (confirmSend = false)} transition:fade={{ duration: 120 }} role="presentation">
    <div class="confirm glass gloss" transition:fly={{ y: 10, duration: 180 }} role="dialog">
      <h3>Send this newsletter?</h3>
      {#if recipients}
        <p>"{draft.subject}" goes to <b>{recipients.count}</b> people
          ({recipients.members} members + {recipients.subscribers} subscribers). Every email
          includes an unsubscribe link.</p>
      {:else}
        <p>Counting recipients…</p>
      {/if}
      <div class="row">
        <button class="ghostb" on:click={() => (confirmSend = false)}>Cancel</button>
        <button class="primaryb" on:click={reallySend} disabled={!recipients || !recipients.count}>
          Send now
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { max-width: 1080px; margin: 0 auto; padding: 28px 24px 60px; display: flex; flex-direction: column; gap: 16px; }
  .head h1 { margin: 0; font-size: 24px; }
  .sub { margin: 4px 0 0; color: var(--text-2); font-size: 14px; }

  .tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--divider); padding-bottom: 0; }
  .tabs button {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 16px; font-size: 14px; font-weight: 500; color: var(--text-3);
    border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer;
    transition: color var(--t-fast), border-color var(--t-fast);
  }
  .tabs button:hover { color: var(--text); }
  .tabs button.on { color: var(--accent-ink); border-bottom-color: var(--accent); }
  .tabs em { font-style: normal; font-size: 11.5px; background: var(--accent-bg); color: var(--accent-ink);
    border-radius: 99px; padding: 1px 8px; }
  .tabs em.hot { background: var(--danger-bg); color: var(--danger); }

  .card { border-radius: var(--r-lg); padding: 16px 18px; }
  .empty { color: var(--text-3); font-size: 13.5px; padding: 28px; text-align: center; }
  .mono { font-family: var(--font-mono); font-size: 12.5px; }
  .dim2 { color: var(--text-3); }

  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--text-3); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--divider); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--divider); color: var(--text); }
  tr:last-child td { border-bottom: none; }
  .chip { font-size: 11px; padding: 2px 9px; border-radius: 99px; border: 1px solid var(--border-strong); color: var(--text-3); }
  .chip.in { border-color: var(--safe); color: var(--safe); background: var(--safe-bg); }
  .chip.out { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); }
  .chip.mid { border-color: var(--caution); color: var(--caution); background: var(--caution-bg); }

  .rlist { display: flex; flex-direction: column; gap: 10px; }
  .rcard { border-radius: var(--r-md); overflow: hidden; }
  .rcard.unread { border-color: var(--accent); }
  .rhead { width: 100%; display: flex; align-items: center; gap: 10px; padding: 13px 16px;
    cursor: pointer; font-size: 14px; color: var(--text); text-align: left; }
  .newdot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
  .rwho { font-weight: 500; }
  .rkind { font-size: 12px; color: var(--text-3); }
  .rdate { margin-left: auto; font-size: 12px; color: var(--text-3); }
  .rbody { padding: 0 16px 14px; }
  .rsummary { margin: 0; white-space: pre-wrap; font: inherit; font-size: 14px; line-height: 1.6;
    color: var(--text-2); background: var(--s1); border-radius: var(--r-sm); padding: 12px 14px; }
  .rtrans { margin-top: 10px; font-size: 13px; }
  .rtrans summary { cursor: pointer; color: var(--text-3); }
  .tline { margin: 8px 0 0; line-height: 1.5; color: var(--text-2); }
  .tline b { color: var(--text); }

  .domain { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px;
    border-radius: var(--r-md); font-size: 13.5px; line-height: 1.5;
    border: 1px solid var(--caution); color: var(--caution); background: var(--caution-bg); }
  .domain.verified { border-color: var(--safe); color: var(--safe); background: var(--safe-bg); }
  .domain i { font-size: 17px; margin-top: 1px; }

  .nlgrid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
  @media (max-width: 900px) { .nlgrid { grid-template-columns: 1fr; } }
  .nlchat, .nlpreview { display: flex; flex-direction: column; gap: 10px; min-height: 420px; }
  .nlpreview { box-shadow: var(--edge-blue), var(--shadow-sm); }
  .nlhead { font-size: 12px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--text-3); display: flex; align-items: center; justify-content: space-between; }
  .htoggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-3);
    cursor: pointer; text-transform: none; letter-spacing: 0; }
  .htoggle:hover { color: var(--accent-ink); }

  .nllines { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
    max-height: 420px; scroll-behavior: smooth; }
  .hint { color: var(--text-3); font-size: 13.5px; line-height: 1.6; margin: 0; }
  .line { margin: 0; font-size: 14px; line-height: 1.55; animation: fade-up 0.25s ease; }
  .line.assistant { color: var(--text); }
  .line.user { color: var(--text-3); text-align: right; }
  .line.dots { display: flex; gap: 4px; }
  .line.dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3);
    animation: dot-bounce 1.2s ease-in-out infinite; }
  .line.dots span:nth-child(2) { animation-delay: 0.15s; }
  .line.dots span:nth-child(3) { animation-delay: 0.3s; }

  .sentlock { display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    padding: 12px 14px; border-radius: var(--r-md);
    border: 1px solid var(--safe); background: var(--safe-bg);
    font-size: 13.5px; color: var(--safe); }
  .sentlock i { font-size: 17px; }
  .freshb { margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: var(--r-pill); background: var(--accent-grad);
    color: var(--accent-t); font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 0 12px var(--accent-glow); }

  .composer { display: flex; gap: 8px; border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 5px 5px 5px 14px; background: var(--s1); }
  .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .composer input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 14px; }
  .send { width: 34px; height: 34px; border-radius: 50%; background: var(--accent-grad);
    color: var(--accent-t); display: grid; place-items: center; font-size: 15px; cursor: pointer; }
  .send:disabled { opacity: 0.5; cursor: default; }

  .subj { background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-sm);
    padding: 10px 13px; color: var(--text); font-size: 14px; font-weight: 500; }
  .subj:focus { border-color: var(--accent); outline: none; }
  .mailframe { flex: 1; min-height: 300px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: #fff; width: 100%; }
  .htmlsrc { flex: 1; min-height: 300px; background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 12px; color: var(--text);
    font-family: var(--font-mono); font-size: 12px; resize: vertical; }

  .sendbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .ghostb { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 13.5px;
    cursor: pointer; padding: 8px 14px; border-radius: var(--r-pill); border: 1px solid var(--border-strong); }
  .ghostb:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
  .ghostb:disabled { opacity: 0.4; cursor: default; }
  .primaryb { padding: 10px 22px; border-radius: var(--r-pill); background: var(--accent-grad);
    color: var(--accent-t); font-size: 14px; font-weight: 500; cursor: pointer;
    box-shadow: 0 0 14px var(--accent-glow); }
  .primaryb:disabled { opacity: 0.5; cursor: default; box-shadow: none; }

  .results { font-size: 13px; color: var(--text-2); }
  .results .fail { margin: 4px 0 0; color: var(--danger); font-size: 12.5px; }

  .hist { display: flex; flex-direction: column; gap: 8px; }
  .hrow { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    font-size: 13.5px; padding: 6px 0; border-bottom: 1px solid var(--divider); }
  .hrow:last-child { border-bottom: none; }
  .htitle { color: var(--text); font-weight: 500; }

  .veil { position: fixed; inset: 0; z-index: 130; background: rgba(0,0,0,0.5);
    display: grid; place-items: center; padding: 20px;
    -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  .confirm { width: min(440px, 100%); border-radius: var(--r-lg); padding: 22px;
    display: flex; flex-direction: column; gap: 12px; }
  .confirm h3 { margin: 0; font-size: 17px; color: var(--text); }
  .confirm p { margin: 0; font-size: 14px; color: var(--text-2); line-height: 1.6; }
  .confirm .row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
</style>
