<script>
  import { onMount, onDestroy } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { appView, loadConnections, notify } from "../lib/store.js";
  import { hasWorkspace } from "../lib/workspaces.js";
  import { brandLogo, MONO_LOGOS, logoUrl } from "../lib/logos.js";

  // If the Composio logo endpoint ever 404s, drop the <img> and reveal the
  // Tabler icon sitting right after it — a real logo first, icon only as a
  // last resort (never a bare generic tile).
  function imgFallback(e) {
    const img = e.currentTarget;
    img.style.display = "none";
    const icon = img.nextElementSibling;
    if (icon) icon.style.display = "";
  }
  import { tilt } from "../lib/tilt.js";

  let loading = true, configured = false, connected = [], featured = [], all = [], query = "", error = "";

  const META = {
    gmail: { icon: "ti-brand-gmail", label: "Gmail", desc: "Read, draft, send" },
    googlecalendar: { icon: "ti-calendar", label: "Google Calendar", desc: "Events, reminders" },
    github: { icon: "ti-brand-github", label: "GitHub", desc: "Repos, issues, PRs" },
    youtube: { icon: "ti-brand-youtube", label: "YouTube", desc: "Uploads, analytics" },
    instagram: { icon: "ti-brand-instagram", label: "Instagram", desc: "Posts, DMs, insights" },
    facebook: { icon: "ti-brand-facebook", label: "Facebook", desc: "Pages, posts" },
    linkedin: { icon: "ti-brand-linkedin", label: "LinkedIn", desc: "Posts, profile" },
    twitter: { icon: "ti-brand-x", label: "Twitter / X", desc: "Post, reply, DMs" },
    notion: { icon: "ti-brand-notion", label: "Notion", desc: "Pages, databases" },
    slack: { icon: "ti-brand-slack", label: "Slack", desc: "Messages, channels" },
  };
  const meta = (k) => META[k] || { icon: "ti-plug", label: k.replace(/_/g, " "), desc: "Connect" };
  const isOn = (k) => connected.includes(k);

  async function load() {
    loading = true; error = "";
    try {
      const d = await api.connections();
      configured = d.configured; connected = d.connected || []; featured = d.featured || []; all = d.all || [];
      loadConnections();   // keep the sidebar's workspace list in sync
      if (d.error) error = "Connections service is warming up.";
    } catch { error = "Couldn't load connections."; }
    loading = false;
  }

  // ── Connect lifecycle: spinner on the button, poll until the OAuth
  //    round-trip lands, then flip the tile into the Active section. ──
  const POLL_MS = 3000;
  const TIMEOUT_MS = 2 * 60 * 1000;
  let connecting = {};   // toolkit -> true while its OAuth flow is pending
  let startedAt = {};    // toolkit -> Date.now() when the flow began
  let pollTimer = null;
  let polling = false;   // guard against overlapping poll requests

  const anyPending = () => Object.values(connecting).some(Boolean);

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, POLL_MS);
    // The OAuth popup closing refocuses this window — check right away.
    window.addEventListener("focus", poll);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    window.removeEventListener("focus", poll);
  }

  async function poll() {
    if (polling) return;
    if (!anyPending()) { stopPolling(); return; }
    polling = true;
    try {
      const d = await api.connections();
      const now = d.connected || [];
      let landed = false;
      for (const k of Object.keys(connecting)) {
        if (!connecting[k]) continue;
        if (now.includes(k)) {
          delete connecting[k];
          delete startedAt[k];
          landed = true;
          notify(`${meta(k).label} connected`, "safe");
        } else if (Date.now() - (startedAt[k] || 0) > TIMEOUT_MS) {
          delete connecting[k];
          delete startedAt[k];
          notify("Connection not completed — try again", "caution");
        }
      }
      connecting = connecting;   // reactivity after deletes
      if (landed) {
        configured = d.configured;
        connected = now;
        featured = d.featured || featured;
        all = d.all || all;
        loadConnections();   // sync the sidebar's workspace list
      }
    } catch { /* transient — next tick retries */ }
    polling = false;
    if (!anyPending()) stopPolling();
  }

  async function connect(toolkit) {
    if (connecting[toolkit]) return;
    try {
      const r = await api.connectionLink(toolkit);
      if (r.ok && r.url) {
        window.open(r.url, "_blank", "noopener,width=600,height=760");
        connecting = { ...connecting, [toolkit]: true };
        startedAt[toolkit] = Date.now();
        startPolling();
      } else error = r.error || "Couldn't start the connection.";
    } catch { error = "Couldn't start the connection."; }
  }

  onDestroy(stopPolling);

  // Active section always shows every live link; the available grid shows the rest.
  $: available = (query
    ? all.filter((k) => k.includes(query.toLowerCase()))
    : featured
  ).filter((k) => !isOn(k));

  onMount(load);
</script>

<div class="page">
  <!-- Page header: title + subtitle left, live stats right (mockup "Ecosystem" header) -->
  <header class="head">
    <div>
      <h1>Connections</h1>
      <p class="sub">Connect your apps — Emblem acts in YOUR accounts, with your approval, always. Sign-in happens securely and can be revoked anytime.</p>
    </div>
    <div class="headside">
      {#if !loading}
        <div class="stat">
          <span class="statlabel">Active links</span>
          <span class="statnum on">{connected.length}</span>
        </div>
        <div class="stat">
          <span class="statlabel">Available</span>
          <span class="statnum">20k+</span>
        </div>
      {/if}
      <button class="btn ghost refresh" on:click={load} aria-label="Refresh connections"><i class="ti ti-refresh"></i></button>
    </div>
  </header>

  {#if error}<div class="banner" in:fade={{ duration: 150 }}>{error}</div>{/if}

  {#if loading}
    <div class="empty">Loading connections…</div>
  {:else}
    {#if connected.length}
      <!-- Active connectors: pulsing-dot section header + glass status cards -->
      <section class="section">
        <div class="secthead">
          <span class="pulse" aria-hidden="true"></span>
          <h2>Active connectors</h2>
        </div>
        <div class="agrid">
          {#each connected as k, i (k)}
            {@const m = meta(k)}
            <div class="acard glass gloss" use:tilt in:fly={{ y: 8, duration: 200, delay: Math.min(i * 20, 200) }}>
              <div class="atop">
                <span class="appicon" class:mono={MONO_LOGOS.has(k)}>
                  {#if brandLogo(k)}{@html brandLogo(k)}
                  {:else}
                    <img class="brandimg" src={logoUrl(k)} alt={m.label} loading="lazy" on:error={imgFallback} />
                    <i class="ti {m.icon}" style="display:none"></i>
                  {/if}
                </span>
                <span class="badge safe">Connected</span>
              </div>
              <div class="name">{m.label}</div>
              <div class="desc">{m.desc}</div>
              <div class="afoot">
                {#if hasWorkspace(k)}
                  <button class="link" on:click={() => appView.set(`workspace:${k}`)}
                    aria-label={`Open ${m.label} workspace`}>
                    Open workspace <i class="ti ti-arrow-right"></i>
                  </button>
                {:else}
                  <span class="footnote">Ready in chat</span>
                {/if}
                <button class="iconbtn" on:click={() => connect(k)}
                  disabled={connecting[k]} title={connecting[k] ? "Reconnecting…" : "Reconnect"}
                  aria-label={`Reconnect ${m.label}`}>
                  {#if connecting[k]}<span class="spin"></span>{:else}<i class="ti ti-refresh"></i>{/if}
                </button>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Available connectors: section header with inline search + bento grid -->
    <section class="section">
      <div class="secthead row">
        <h2>Available connectors</h2>
        <div class="search">
          <i class="ti ti-search"></i>
          <input placeholder="Search 20,000+ tools — Gmail, GitHub, Stripe, Linear…" bind:value={query}
            aria-label="Search tools to connect" />
        </div>
      </div>
      <div class="grid" data-tour="connect-grid">
        {#each available as k, i (k)}
          {@const m = meta(k)}
          <div class="tile glass gloss" use:tilt in:fly={{ y: 8, duration: 200, delay: Math.min(i * 20, 200) }}>
            <span class="bigicon" class:mono={MONO_LOGOS.has(k)}>
              {#if brandLogo(k)}{@html brandLogo(k)}
              {:else}
                <img class="brandimg" src={logoUrl(k)} alt={m.label} loading="lazy" on:error={imgFallback} />
                <i class="ti {m.icon}" style="display:none"></i>
              {/if}
            </span>
            <div class="name center">{m.label}</div>
            <div class="desc center">{m.desc}</div>
            <button class="btn primary cbtn" on:click={() => connect(k)}
              disabled={connecting[k]} aria-label={`Connect ${m.label}`}>
              {#if connecting[k]}<span class="spin"></span> Connecting…{:else}Connect{/if}
            </button>
          </div>
        {/each}
      </div>
      {#if available.length === 0}
        <div class="empty">
          {query ? "No matches — try another name." : "All featured apps are connected. Search to reach 20,000+ more."}
        </div>
      {:else if !query}
        <div class="hint">Showing featured apps. Search above to reach all 20,000+ tools.</div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 60px; }

  /* ── Page header ── */
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 32px; flex-wrap: wrap; }
  h1 { font-size: 32px; font-weight: 600; letter-spacing: -0.03em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; max-width: 560px; margin: 0; line-height: 1.55; }
  .headside { display: flex; align-items: flex-end; gap: 24px; }
  .stat { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .statlabel { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .statnum { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); line-height: 1.1; }
  .statnum.on { color: var(--accent-ink); }
  .refresh { padding: 9px 12px; cursor: pointer; }

  .banner {
    background: var(--accent-bg); color: var(--text);
    border: 1px solid var(--border-strong);
    padding: 10px 14px; border-radius: var(--r-md); font-size: 13px; margin-bottom: 16px;
  }

  /* ── Section headers ── */
  .section { margin-bottom: 40px; }
  .section:last-child { margin-bottom: 0; }
  .secthead { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .secthead.row { justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .secthead h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: var(--text); }
  .pulse {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent); flex: 0 0 auto;
    animation: pulsedot 2s ease-in-out infinite;
  }
  @keyframes pulsedot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* ── Search (inline in section header) ── */
  .search {
    display: flex; align-items: center; gap: 10px;
    background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-md); padding: 9px 14px;
    width: min(420px, 100%);
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .search i { color: var(--text-3); font-size: 17px; }
  .search input { flex: 1; min-width: 0; border: none; background: none; outline: none; font-size: 14px; color: var(--text); }

  /* ── Active connector cards ── */
  .agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
  .acard {
    display: flex; flex-direction: column; align-items: stretch;
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 20px;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .acard:hover { border-color: var(--accent-glow); box-shadow: var(--shadow-md); }
  .atop { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  .appicon {
    width: 48px; height: 48px; border-radius: var(--r-md);
    display: grid; place-items: center;
    background: var(--bg-2); border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
  }
  .appicon i { font-size: 26px; color: var(--accent-ink); }
  .appicon :global(svg) { width: 26px; height: 26px; display: block; }
  .appicon .brandimg { width: 26px; height: 26px; object-fit: contain; display: block; }
  .appicon.mono :global(svg) { color: var(--text); }
  .afoot {
    margin-top: auto; padding-top: 12px; border-top: 1px solid var(--divider);
    display: flex; justify-content: space-between; align-items: center; gap: 10px;
  }
  .link {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 13px; font-weight: 600; color: var(--accent-ink);
    padding: 2px 0; cursor: pointer;
    transition: opacity var(--t-fast);
  }
  .link:hover { opacity: 0.8; }
  .footnote { font-size: 12px; color: var(--text-3); }
  .iconbtn {
    width: 30px; height: 30px; border-radius: var(--r-sm);
    display: grid; place-items: center;
    color: var(--text-3); cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast);
  }
  .iconbtn:hover { color: var(--accent-ink); background: var(--accent-bg); }
  .iconbtn i { font-size: 17px; }

  /* ── Available bento grid ── */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px; }
  .tile {
    display: flex; flex-direction: column; align-items: center; text-align: center;
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 20px 16px 16px;
    cursor: pointer;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .tile:hover { border-color: var(--accent-glow); box-shadow: var(--shadow-md); }
  .bigicon {
    width: 56px; height: 56px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--bg-2); border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    margin-bottom: 12px;
  }
  .bigicon i { font-size: 28px; color: var(--text-2); }
  .tile:hover .bigicon i { color: var(--accent-ink); }
  .bigicon :global(svg) { width: 30px; height: 30px; display: block; }
  .bigicon .brandimg { width: 30px; height: 30px; object-fit: contain; display: block; }
  .bigicon.mono :global(svg) { color: var(--text-2); }
  .tile:hover .bigicon.mono :global(svg) { color: var(--text); }

  .name { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .desc { font-size: 13px; color: var(--text-2); margin-top: 2px; margin-bottom: 12px; }
  .center { text-align: center; }

  .cbtn { width: 100%; font-size: 13px; padding: 8px 14px; cursor: pointer; margin-top: auto; }
  /* Spinner inherits the button's text color (ink on the white-hot fill). */
  .cbtn .spin, .iconbtn .spin {
    width: 13px; height: 13px;
    border-color: var(--accent-bg); border-top-color: currentColor;
  }
  .iconbtn:disabled { cursor: default; }

  .hint { text-align: center; color: var(--text-3); font-size: 13px; margin-top: 24px; }

  @media (max-width: 640px) {
    h1 { font-size: 26px; }
    .headside { width: 100%; justify-content: flex-start; }
  }
</style>
