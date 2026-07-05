<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { get } from "svelte/store";
  import { config, me, notify, refresh, setFlag } from "../lib/store.js";
  import { api } from "../lib/api.js";

  const emit = createEventDispatcher();

  const isAdmin = get(me).is_admin;

  let brain = { provider: "cerebras", model: "gpt-oss-120b", key: "" };
  let voice = { engine: "edge", voice: "en-US-AriaNeural", rate: "+0%" };
  let secrets = [];
  let newKey = ""; let newVal = "";
  let composioKey = "";
  let composioApps = [];
  let composioConnected = [];
  let profile = { display_name: "", quiet_start: "22:00", quiet_end: "07:00" };
  let tab = isAdmin ? "ai" : "profile"; // admin: ai|voice|apps|security|secrets — user: profile|apps

  onMount(async () => {
    // Owner-only surfaces are never even requested for regular users — nothing about
    // providers/secrets appears in their network tab.
    if (isAdmin) {
      try { brain = { ...brain, ...(await api.brain()) }; } catch {}
      try { voice = { ...voice, ...(await api.voiceConfig()) }; } catch {}
      try {
        const r = await api.secrets(); secrets = r.secrets || r.items || [];
        const ck = secrets.find(s => s.name === "composio_key");
        if (ck) composioKey = "••••••••";
      } catch {}
    } else {
      try { profile = { ...profile, ...(await api.profile()) }; } catch {}
    }
    try {
      const r = await api.connections();
      composioApps = r.all || [];
      composioConnected = r.connected || [];
    } catch {}
  });

  async function saveProfile() {
    try {
      await api.profileSet(profile);
      notify("Profile saved", "safe");
    } catch (e) { notify("Failed: " + e.message, "danger"); }
  }

  async function saveBrain() {
    try {
      await api.setBrain(brain);
      await refresh();
      notify("Brain updated", "safe");
    } catch (e) { notify("Failed: " + e.message, "danger"); }
  }

  async function saveVoice() {
    try {
      await api.voiceSetConfig(voice);
      notify("Voice updated", "safe");
    } catch (e) { notify("Failed: " + e.message, "danger"); }
  }

  async function saveComposioKey() {
    if (!composioKey || composioKey === "••••••••") return;
    try {
      await api.setSecret("composio_key", composioKey);
      notify("Service key saved", "safe");
      composioKey = "••••••••";
    } catch (e) { notify("Failed: " + e.message, "danger"); }
  }

  async function connectApp(app) {
    try {
      const r = await api.connectionLink(app);
      if (r.url) window.open(r.url, "_blank");
      else notify(r.error || "Couldn't start the connection", "danger");
    } catch (e) { notify("OAuth failed: " + e.message, "danger"); }
  }

  async function addSecret() {
    if (!newKey.trim()) return;
    try {
      await api.setSecret(newKey.trim(), newVal);
      secrets = [...secrets.filter(s => s.name !== newKey.trim()), { name: newKey.trim() }];
      newKey = ""; newVal = "";
      notify("Secret saved", "safe");
    } catch (e) { notify("Failed", "danger"); }
  }

  async function deleteSecret(name) {
    try {
      await api.deleteSecret(name);
      secrets = secrets.filter(s => s.name !== name);
      notify("Deleted", "safe");
    } catch {}
  }

  const TABS = isAdmin
    ? [
        { id: "ai",       label: "AI Brain" },
        { id: "voice",    label: "Voice" },
        { id: "apps",     label: "Connected Apps" },
        { id: "security", label: "Security" },
        { id: "secrets",  label: "Secrets" },
      ]
    : [
        { id: "profile", label: "Profile" },
        { id: "apps",    label: "Connected Apps" },
      ];

  // Popular Composio apps to show first
  const FEATURED_APPS = ["gmail", "slack", "github", "notion", "googlecalendar", "linear", "jira", "discord", "twitter", "zoom", "hubspot", "salesforce"];
</script>

<div class="overlay" on:click|self={() => emit("close")}></div>

<div class="panel" role="dialog">
  <div class="panel-header">
    <h2>Settings</h2>
    <button class="close-btn" on:click={() => emit("close")}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="tabs">
    {#each TABS as t}
      <button class="tab" class:active={tab===t.id} on:click={() => tab=t.id}>{t.label}</button>
    {/each}
  </div>

  <div class="body">

    {#if tab === "profile"}
      <div class="section">
        <h3>Your profile</h3>
        <div class="field">
          <span>Display name</span>
          <input bind:value={profile.display_name} placeholder="How should Emblem address you?" />
        </div>
        <div class="field">
          <span>Quiet hours start</span>
          <input bind:value={profile.quiet_start} placeholder="22:00" />
        </div>
        <div class="field">
          <span>Quiet hours end</span>
          <input bind:value={profile.quiet_end} placeholder="07:00" />
        </div>
        <p class="hint">Automations hold non-urgent updates during quiet hours.</p>
        <button class="btn primary" on:click={saveProfile}>Save</button>
      </div>

    {:else if tab === "ai"}
      <div class="section">
        <h3>Engine</h3>
        <div class="field">
          <span>Engine tier</span>
          <select bind:value={brain.provider}>
            <option value="cerebras">Fast</option>
            <option value="groq">Balanced</option>
            <option value="claude">Advanced A</option>
            <option value="openai">Advanced B</option>
            <option value="gemini">Advanced C</option>
          </select>
        </div>
        <div class="field">
          <span>Model</span>
          <input bind:value={brain.model} placeholder="gpt-oss-120b" />
        </div>
        <div class="field">
          <span>API Key</span>
          <input type="password" bind:value={brain.key} placeholder="Enter API key…" />
        </div>
        <button class="btn primary" on:click={saveBrain}>Save</button>
      </div>

    {:else if tab === "voice"}
      <div class="section">
        <h3>Voice</h3>
        <div class="field">
          <span>Voice engine</span>
          <select bind:value={voice.engine}>
            <option value="edge">Neural (cloud)</option>
            <option value="gemini">Neural HD</option>
            <option value="piper">Offline</option>
          </select>
        </div>
        <div class="field">
          <span>Voice</span>
          <input bind:value={voice.voice} placeholder="en-US-AriaNeural" />
        </div>
        <div class="field">
          <span>Rate</span>
          <input bind:value={voice.rate} placeholder="+0%" />
        </div>
        <button class="btn primary" on:click={saveVoice}>Save</button>
      </div>

    {:else if tab === "apps"}
      <div class="section">
        <h3>Connections service key</h3>
        <p class="hint">The service credential that powers app connections.</p>
        <div class="field">
          <span>Service key</span>
          <input type="password" bind:value={composioKey} placeholder="key…" />
        </div>
        <button class="btn primary" on:click={saveComposioKey}>Save Key</button>

        <h3 style="margin-top:24px">Connect Apps</h3>
        <p class="hint">Click an app to connect via OAuth. Once connected, Emblem can use it automatically.</p>

        <div class="app-grid">
          {#each FEATURED_APPS as app}
            {@const connected = composioConnected.includes(app)}
            <button class="app-card" class:connected on:click={() => connectApp(app)}>
              <span class="app-name">{app}</span>
              {#if connected}
                <span class="badge safe">Connected</span>
              {:else}
                <span class="badge accent">Connect</span>
              {/if}
            </button>
          {/each}
          {#each composioApps.filter(a => !FEATURED_APPS.includes(a)) as app}
            {@const connected = composioConnected.includes(app)}
            <button class="app-card" class:connected on:click={() => connectApp(app)}>
              <span class="app-name">{app}</span>
              {#if connected}
                <span class="badge safe">Connected</span>
              {:else}
                <span class="badge accent">Connect</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

    {:else if tab === "security"}
      <div class="section">
        <h3>Safety Controls</h3>
        <div class="setting-row">
          <div>
            <div class="setting-label">Kill Switch</div>
            <div class="setting-desc">Block all tool execution immediately</div>
          </div>
          <button class="toggle danger" class:on={$config.kill_switch} on:click={() => setFlag("kill_switch", !$config.kill_switch)}>
            <div class="knob"></div>
          </button>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Local Only</div>
            <div class="setting-desc">Block all network tool calls</div>
          </div>
          <button class="toggle" class:on={$config.local_only} on:click={() => setFlag("local_only", !$config.local_only)}>
            <div class="knob"></div>
          </button>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Approval Mode</div>
            <div class="setting-desc">Require approval for dangerous actions</div>
          </div>
          <select bind:value={$config.approval_mode} style="background:var(--s2);border:1px solid var(--border);border-radius:var(--r-md);padding:5px 8px;color:var(--text);font-size:12px;">
            <option value="ask">Ask always</option>
            <option value="auto">Full auto</option>
          </select>
        </div>
      </div>

    {:else if tab === "secrets"}
      <div class="section">
        <h3>Encrypted Secrets</h3>
        <p class="hint">Stored encrypted. Used by tools and connectors.</p>
        {#each secrets as s}
          <div class="secret-row">
            <code class="secret-name">{s.name}</code>
            <span class="secret-val">••••••••</span>
            <button class="btn ghost" on:click={() => deleteSecret(s.name)} style="font-size:11px;padding:3px 8px;color:var(--danger)">Delete</button>
          </div>
        {/each}
        <div class="add-secret">
          <input bind:value={newKey} placeholder="Key name" class="secret-input" />
          <input bind:value={newVal} type="password" placeholder="Value" class="secret-input" />
          <button class="btn primary" on:click={addSecret} style="flex-shrink:0">Add</button>
        </div>
      </div>
    {/if}

  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 100;
    backdrop-filter: blur(2px);
    animation: fade-up var(--t-fast) ease;
  }

  .panel {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: 420px;
    background: var(--s1);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    z-index: 101;
    animation: slide-in var(--t-normal) var(--spring);
  }

  @keyframes slide-in {
    from { transform: translateX(60px); opacity: 0; }
    to   { transform: none; opacity: 1; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .panel-header h2 { margin: 0; font-size: 15px; font-weight: 500; color: var(--text); }

  .close-btn {
    width: 30px; height: 30px;
    border-radius: var(--r-md);
    display: grid; place-items: center;
    color: var(--text-3);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .close-btn:hover { background: var(--s2); color: var(--text); }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .tab {
    padding: 5px 10px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-3);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .tab:hover { background: var(--s2); color: var(--text-2); }
  .tab.active { background: var(--accent-bg); color: var(--accent-t); }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .section { display: flex; flex-direction: column; gap: 14px; }
  .section h3 { margin: 0; font-size: 13px; font-weight: 500; color: var(--text); letter-spacing: -0.01em; }

  .hint { margin: 0; font-size: 12px; color: var(--text-3); line-height: 1.5; }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    background: var(--s2);
    border-radius: var(--r-md);
  }

  .setting-label { font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 2px; }
  .setting-desc  { font-size: 11px; color: var(--text-3); }

  .app-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .app-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--s2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .app-card:hover { background: var(--s3); border-color: var(--border-strong); }
  .app-card.connected { border-color: rgba(52,211,153,0.3); }

  .app-name { font-size: 12px; font-weight: 500; color: var(--text-2); text-transform: capitalize; }

  .secret-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--s2);
    border-radius: var(--r-md);
  }
  .secret-name { font-size: 12px; color: var(--accent-t); flex: 1; font-family: var(--font-mono); }
  .secret-val { font-size: 12px; color: var(--text-3); flex: 1; }

  .add-secret { display: flex; gap: 8px; margin-top: 4px; }
  .secret-input {
    flex: 1; padding: 8px 10px; border-radius: var(--r-md);
    background: var(--s2); border: 1px solid var(--border);
    color: var(--text); font-size: 12px; outline: none;
    transition: border-color var(--t-fast);
  }
  .secret-input:focus { border-color: var(--accent-t); }
</style>
