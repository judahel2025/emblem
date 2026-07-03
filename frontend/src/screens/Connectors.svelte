<script>
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";

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
      if (d.error) error = "Connections service is warming up.";
    } catch { error = "Couldn't load connections."; }
    loading = false;
  }

  async function connect(toolkit) {
    try {
      const r = await api.connectionLink(toolkit);
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener,width=600,height=760");
      else error = r.error || "Couldn't start the connection.";
    } catch { error = "Couldn't start the connection."; }
  }

  $: shown = (query
    ? all.filter((k) => k.includes(query.toLowerCase()))
    : featured
  );

  onMount(load);
</script>

<div class="page">
  <header class="head">
    <div>
      <h1>Connections</h1>
      <p class="sub">Connect your apps — Emblem acts in YOUR accounts, with your approval, always. Sign-in happens securely and can be revoked anytime.</p>
    </div>
    <button class="btn ghost refresh" on:click={load} aria-label="Refresh connections"><i class="ti ti-refresh"></i></button>
  </header>

  {#if error}<div class="banner" in:fade={{ duration: 150 }}>{error}</div>{/if}

  <div class="search">
    <i class="ti ti-search"></i>
    <input placeholder="Search 20,000+ tools — Gmail, GitHub, Stripe, Linear…" bind:value={query}
      aria-label="Search tools to connect" />
  </div>

  {#if loading}
    <div class="empty">Loading connections…</div>
  {:else}
    <div class="grid" data-tour="connect-grid">
      {#each shown as k, i (k)}
        {@const m = meta(k)}
        {@const on = isOn(k)}
        <div class="tile gloss" class:on in:fly={{ y: 8, duration: 200, delay: Math.min(i * 20, 200) }}>
          <div class="top">
            <span class="appicon"><i class="ti {m.icon}"></i></span>
            {#if on}<span class="badge safe">Connected</span>{/if}
          </div>
          <div class="name">{m.label}</div>
          <div class="desc">{m.desc}</div>
          {#if on}
            <button class="btn ghost cbtn" on:click={() => connect(k)} aria-label={`Reconnect ${m.label}`}>Reconnect</button>
          {:else}
            <button class="btn primary cbtn" on:click={() => connect(k)} aria-label={`Connect ${m.label}`}>
              Connect <i class="ti ti-arrow-right"></i>
            </button>
          {/if}
        </div>
      {/each}
    </div>
    {#if !query}<div class="hint">Showing featured apps. Search above to reach all 20,000+ tools.</div>{/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: 28px 24px 60px; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; max-width: 560px; margin: 0; line-height: 1.55; }
  .refresh { padding: 9px 12px; cursor: pointer; }

  .banner {
    background: var(--accent-bg); color: var(--text);
    border: 1px solid var(--border-strong);
    padding: 10px 14px; border-radius: var(--r-md); font-size: 13px; margin-bottom: 16px;
  }

  .search {
    display: flex; align-items: center; gap: 10px;
    background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-md); padding: 11px 16px; margin-bottom: 22px;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .search i { color: var(--text-3); font-size: 18px; }
  .search input { flex: 1; border: none; background: none; outline: none; font-size: 15px; color: var(--text); }

  /* ── Tile grid ── */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
  .tile {
    display: flex; flex-direction: column; align-items: flex-start;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 18px;
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .tile:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }
  .tile.on { border-color: var(--accent); background: var(--accent-bg); }

  .top { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 12px; }
  .appicon {
    width: 42px; height: 42px; border-radius: var(--r-md);
    display: grid; place-items: center;
    background: var(--s2); border: 1px solid var(--border);
  }
  .appicon i { font-size: 24px; color: var(--accent-ink); }

  .name { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .desc { font-size: 13px; color: var(--text-2); margin-top: 2px; margin-bottom: 14px; }

  .cbtn { width: 100%; font-size: 13px; padding: 8px 14px; cursor: pointer; }
  .btn.ghost.cbtn { border: 1px solid var(--border-strong); }

  .hint { text-align: center; color: var(--text-3); font-size: 13px; margin-top: 24px; }
</style>
