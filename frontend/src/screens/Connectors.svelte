<script>
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";

  let loading = true, configured = false, connected = [], featured = [], all = [], query = "", error = "";

  const META = {
    gmail: { icon: "ti-brand-google-filled", label: "Gmail", desc: "Read, draft, send" },
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
  <div class="head">
    <div>
      <h1>Connections</h1>
      <p class="sub">Connect the tools you work in. Your accounts stay private to you — sign-in happens securely and can be revoked anytime.</p>
    </div>
    <button class="refresh" on:click={load} title="Refresh"><i class="ti ti-refresh"></i></button>
  </div>

  {#if error}<div class="banner">{error}</div>{/if}

  <div class="search">
    <i class="ti ti-search"></i>
    <input placeholder="Search 20,000+ tools — Gmail, GitHub, Stripe, Linear…" bind:value={query} />
  </div>

  {#if loading}
    <div class="empty">Loading connections…</div>
  {:else}
    <div class="grid">
      {#each shown as k}
        {@const m = meta(k)}
        <div class="tile" class:on={isOn(k)}>
          <div class="top">
            <i class="ti {m.icon}"></i>
            {#if isOn(k)}<span class="pill on">Connected</span>{:else}<span class="pill">Connect</span>{/if}
          </div>
          <div class="name">{m.label}</div>
          <div class="desc">{m.desc}</div>
          {#if !isOn(k)}
            <button class="cbtn" on:click={() => connect(k)}>Connect <i class="ti ti-arrow-right"></i></button>
          {:else}
            <button class="cbtn ghost" on:click={() => connect(k)}>Reconnect</button>
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
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 14px; max-width: 560px; margin: 0; line-height: 1.55; }
  .refresh { width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--border); background: var(--s1);
    color: var(--text-2); cursor: pointer; display: grid; place-items: center; }
  .banner { background: var(--accent-bg); color: var(--accent-t); border: 1px solid var(--border-strong);
    padding: 10px 14px; border-radius: 12px; font-size: 13px; margin-bottom: 16px; }
  .search { display: flex; align-items: center; gap: 10px; background: var(--s1); border: 1px solid var(--border);
    border-radius: 14px; padding: 12px 16px; margin-bottom: 22px; }
  .search i { color: var(--text-3); font-size: 18px; }
  .search input { flex: 1; border: none; background: none; outline: none; font-size: 15px; color: var(--text); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
  .tile { background: var(--s1); border: 1px solid var(--border); border-radius: 16px; padding: 18px; transition: all .18s; }
  .tile:hover { border-color: var(--border-strong); transform: translateY(-2px); }
  .tile.on { background: var(--accent-bg); border-color: var(--border-strong); }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .top i { font-size: 26px; color: var(--accent-t); }
  .pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; background: var(--s2);
    color: var(--text-3); border: 1px solid var(--border); }
  .pill.on { background: #E4F3E8; color: #2C7A4B; border-color: #cfe9d6; }
  .name { font-size: 15px; font-weight: 700; color: var(--text); }
  .desc { font-size: 13px; color: var(--text-2); margin-top: 2px; margin-bottom: 14px; }
  .cbtn { width: 100%; background: var(--accent); color: var(--accent-t); border: none; padding: 9px;
    border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex;
    align-items: center; justify-content: center; gap: 6px; }
  .cbtn.ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text-2); }
  .hint { text-align: center; color: var(--text-3); font-size: 13px; margin-top: 24px; }
  .empty { text-align: center; color: var(--text-3); padding: 60px; }
</style>
