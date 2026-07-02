<script>
  import { onMount } from "svelte";
  import { config, setFlag, notify, refresh } from "../lib/store.js";
  import { api } from "../lib/api.js";

  let secrets = [];
  let dpapi = false;
  let newName = "";
  let newValue = "";

  let vcfg = { engine: "edge", voice: "en-US-AriaNeural", rate: "+0%" };
  let voices = [];
  let rateNum = 0;
  const SEL = "background:var(--bg-2);border:1px solid var(--line);border-radius:7px;padding:7px 10px;color:var(--text);outline:none;";

  async function loadVoice() {
    vcfg = { ...vcfg, ...(await api.voiceConfig().catch(() => ({}))) };
    rateNum = parseInt((vcfg.rate || "+0%").replace(/[+%]/g, "")) || 0;
    voices = (await api.voiceVoices(vcfg.engine).catch(() => ({ voices: [] }))).voices;
  }
  async function changeEngine() {
    voices = (await api.voiceVoices(vcfg.engine).catch(() => ({ voices: [] }))).voices;
  }
  function rateStr() { return (rateNum >= 0 ? "+" : "") + rateNum + "%"; }
  async function saveVoice() {
    await api.voiceSetConfig({ engine: vcfg.engine, voice: vcfg.voice, rate: rateStr() });
    notify("Voice updated", "safe");
  }
  async function testVoice() {
    try { new Audio(await api.ttsUrl("Hi, I'm Emblem. This is how I'll sound to you.", vcfg.voice, rateStr(), vcfg.engine)).play(); }
    catch { notify("Couldn't play the test", "danger"); }
  }

  let fwKey = "";
  let fwStatus = "checking…";
  async function testFw() {
    const r = await api.execute("flutterwave.stats").catch(() => null);
    const res = r?.result;
    fwStatus = !res?.configured ? "Not connected"
      : res.ok ? `Connected ✓  (${res.successful} payments)` : `Key set, error: ${res.error || "?"}`;
  }
  async function saveFw() {
    if (!fwKey.trim()) return;
    await api.setSecret("flutterwave_secret", fwKey.trim());
    fwKey = ""; notify("Flutterwave key saved (encrypted)", "safe"); testFw();
  }

  // Estoppel connection: DB (full read) + Resend key (send mail/newsletters as Estoppel)
  let estPg = "", estResend = "", estStatus = "checking…";
  async function testEst() {
    const r = await api.execute("estoppel.users").catch(() => null);
    const res = r?.result;
    estStatus = !res ? "error" : res.configured === false ? "DB not connected"
      : res.ok ? `Connected ✓ (${res.total_users} users)` : `error: ${res.error || "?"}`;
  }
  async function saveEst() {
    if (estPg.trim()) await api.setSecret("estoppel_pg", estPg.trim());
    if (estResend.trim()) await api.setSecret("estoppel_resend_key", estResend.trim());
    estPg = ""; estResend = ""; notify("Estoppel connection saved (encrypted)", "safe"); testEst();
  }

  let brain = { provider: "claude", model: "claude-opus-4-8", defaults: {}, labels: {}, status: {} };
  let brainKey = "";
  const KEYNAME = { claude: "anthropic_key", openai: "openai_key", gemini: "gemini_key" };
  async function loadBrain() { brain = { ...brain, ...(await api.brain().catch(() => ({}))) }; }
  function onProvider() { brain.model = brain.defaults?.[brain.provider] || brain.model; }
  async function saveBrain() {
    await api.setBrain({ provider: brain.provider, model: brain.model });
    if (brainKey.trim() && KEYNAME[brain.provider]) { await api.setSecret(KEYNAME[brain.provider], brainKey.trim()); brainKey = ""; }
    notify("AI brain updated", "safe"); loadBrain();
  }

  async function loadSecrets() {
    const r = await api.secrets().catch(() => ({ items: [], dpapi: false }));
    secrets = r.items || [];
    dpapi = r.dpapi;
  }
  async function addSecret() {
    if (!newName.trim() || !newValue.trim()) return;
    await api.setSecret(newName.trim(), newValue);
    notify(`Secret '${newName.trim()}' encrypted`, "safe");
    newName = ""; newValue = "";
    loadSecrets();
  }
  async function removeSecret(name) {
    await api.deleteSecret(name);
    notify(`Removed '${name}'`, "caution");
    loadSecrets();
  }

  let lockEnabled = false, lockPw = "", lockCur = "";
  async function loadLock() { lockEnabled = (await api.lockStatus().catch(() => ({ enabled: false }))).enabled; }
  async function saveLock() {
    if ((lockPw || "").length < 4) { notify("Password must be at least 4 characters", "caution"); return; }
    const r = await api.lockSet(lockPw, lockCur).catch(() => ({ ok: false }));
    if (r.ok) { lockPw = ""; lockCur = ""; notify("App lock set", "safe"); loadLock(); }
    else notify(r.error || "Couldn't set the lock", "danger");
  }
  async function disableLock() {
    const r = await api.lockDisable(lockCur).catch(() => ({ ok: false }));
    if (r.ok) { lockCur = ""; notify("App lock disabled", "caution"); loadLock(); }
    else notify(r.error || "Wrong password", "danger");
  }

  async function setApprovalMode(mode) {
    await api.approvalMode(mode);
    notify(mode === "auto" ? "Full-auto on — Emblem acts without asking (except deletes)" : "Confirm mode — Emblem asks before sensitive actions", mode === "auto" ? "caution" : "safe");
    refresh();
  }
  async function clearTrust(tool) {
    await api.setTrust(tool, false);
    notify(`No longer auto-allowing ${tool}`, "caution");
    refresh();
  }

  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent);
  let mobileToken = "";
  function saveMobileConn() {
    if (mobileToken.trim()) {
      localStorage.setItem("emblem_token", mobileToken.trim());
      notify("Token updated — restart the app to reconnect", "safe");
    }
  }

  onMount(() => { loadSecrets(); loadVoice(); testFw(); loadBrain(); loadLock(); testEst(); });
</script>

{#if isMobile}
<div class="head"><h3>Connection</h3></div>
<div class="card flags">
  <div class="frow">
    <i class="ti ti-cloud" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Backend</b><span class="muted">https://emblemai-og7e.onrender.com (always on)</span></div>
  </div>
  <div class="frow">
    <i class="ti ti-key" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Access token</b><span class="muted">Paste a new token to replace the current one</span></div>
    <input bind:value={mobileToken} style={SEL + "max-width:200px;"} type="password" placeholder="new token…" />
  </div>
  <button class="sbtn safe" on:click={saveMobileConn}>Update token</button>
</div>
{/if}

<div class="head"><h3>AI brain</h3><span class="badge {brain.status?.ready ? 'safe' : 'caution'}">{brain.status?.ready ? 'ready' : 'needs key'}</span></div>
<div class="card flags">
  <div class="frow">
    <i class="ti ti-brain" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Provider</b><span class="muted">{brain.labels?.[brain.provider] || brain.provider} — online providers are far smarter; Ollama runs offline</span></div>
    <select bind:value={brain.provider} on:change={onProvider} style={SEL}>
      <option value="cerebras">Cerebras (fast, free)</option>
      <option value="groq">Groq — llama-3.3-70b (free)</option>
      <option value="claude">Claude (Anthropic)</option>
      <option value="openai">OpenAI</option>
      <option value="gemini">Google Gemini</option>
    </select>
  </div>
  <div class="frow">
    <i class="ti ti-cpu" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Model</b><span class="muted">default: {brain.defaults?.[brain.provider] || '—'}</span></div>
    <input bind:value={brain.model} style={SEL + "max-width:230px;"} />
  </div>
  <div class="addrow" style="display:flex;gap:8px;margin-top:6px">
    <input style={SEL + "flex:1;"} type="password" placeholder="{brain.labels?.[brain.provider] || ''} API key (stored encrypted)" bind:value={brainKey} />
  </div>
  <div style="display:flex;gap:8px;margin-top:12px">
    <button class="btn primary" on:click={saveBrain}>Save brain</button>
  </div>
</div>

<div class="head" style="margin-top:22px"><h3>Voice</h3></div>
<div class="card flags">
  <div class="frow">
    <i class="ti ti-microphone" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Engine</b><span class="muted">Edge neural (natural, online) · Piper (offline) · Master Judah cloned (local CPU)</span></div>
    <select bind:value={vcfg.engine} on:change={changeEngine} style={SEL}>
      <option value="edge">Edge Neural</option>
      <option value="piper">Piper (offline)</option>
      <option value="clone">Master Judah (cloned)</option>
    </select>
  </div>
  {#if vcfg.engine === "clone"}
  <div class="frow" style="opacity:0.7">
    <i class="ti ti-cpu" style="color:var(--caution)"></i>
    <div class="ft"><b>Local CPU · ~12s per response</b><span class="muted">Runs entirely offline on this PC — first load takes ~21s. Speaking rate not used.</span></div>
  </div>
  {/if}
  <div class="frow">
    <i class="ti ti-volume" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Voice</b><span class="muted">{voices.length} voices available</span></div>
    <select bind:value={vcfg.voice} style={SEL + "max-width:230px;"}>
      {#each voices as v}<option value={v.id}>{v.name} {v.gender}</option>{/each}
    </select>
  </div>
  <div class="frow">
    <i class="ti ti-gauge" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Speaking rate</b><span class="muted">{rateNum > 0 ? "+" : ""}{rateNum}% (faster ▸)</span></div>
    <input type="range" min="-40" max="60" step="5" bind:value={rateNum} style="width:170px" />
  </div>
  <div style="display:flex;gap:8px;margin-top:12px">
    <button class="btn" on:click={testVoice}><i class="ti ti-player-play"></i> Test</button>
    <button class="btn primary" on:click={saveVoice}>Save voice</button>
  </div>
</div>

<div class="head" style="margin-top:22px"><h3>Security &amp; safety</h3></div>
<div class="card flags">
  <div class="frow">
    <i class="ti ti-player-power" style="color:var(--danger)"></i>
    <div class="ft"><b>Kill switch</b><span class="muted">Block every tool from running, instantly.</span></div>
    <button class="toggle danger" class:on={$config.kill_switch} on:click={() => setFlag("kill_switch", !$config.kill_switch)}><span class="knob"></span></button>
  </div>
  <div class="frow">
    <i class="ti ti-wifi-off" style="color:var(--caution)"></i>
    <div class="ft"><b>Local-only mode</b><span class="muted">Refuse any tool that needs the internet.</span></div>
    <button class="toggle" class:on={$config.local_only} on:click={() => setFlag("local_only", !$config.local_only)}><span class="knob"></span></button>
  </div>
  <div class="frow">
    <i class="ti ti-bolt" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Approval mode</b><span class="muted">{$config.approval_mode === "auto" ? "Full-auto — Emblem sends/acts immediately (deletes still confirm)" : "Confirm — Emblem asks “send it, or you do it?” before sensitive actions"}</span></div>
    <div class="seg">
      <button class:on={($config.approval_mode || "ask") === "ask"} on:click={() => setApprovalMode("ask")}>Confirm</button>
      <button class:on={$config.approval_mode === "auto"} on:click={() => setApprovalMode("auto")}>Full-auto</button>
    </div>
  </div>
  {#if ($config.remembered_approvals || []).length}
    <div class="frow" style="align-items:flex-start">
      <i class="ti ti-shield-check" style="color:var(--safe)"></i>
      <div class="ft"><b>Always-allowed actions</b>
        <div class="trustlist">
          {#each $config.remembered_approvals as t}
            <span class="trust">{t}<button on:click={() => clearTrust(t)} title="Stop auto-allowing"><i class="ti ti-x"></i></button></span>
          {/each}
        </div>
      </div>
    </div>
  {/if}
  <div class="frow">
    <i class="ti ti-lock" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Master password</b><span class="muted">{lockEnabled ? "On — Emblem asks for it when she comes on" : "Off — anyone on this PC can open Emblem"}</span></div>
    <span class="badge {lockEnabled ? 'safe' : 'caution'}">{lockEnabled ? "on" : "off"}</span>
  </div>
  <div class="addrow" style="display:flex;gap:8px;margin-top:6px">
    {#if lockEnabled}<input style={SEL + "flex:1;"} type="password" placeholder="current password" bind:value={lockCur} />{/if}
    <input style={SEL + "flex:1;"} type="password" placeholder={lockEnabled ? "new password" : "set a master password"} bind:value={lockPw} />
    <button class="btn primary" on:click={saveLock}>{lockEnabled ? "Change" : "Enable lock"}</button>
    {#if lockEnabled}<button class="btn" on:click={disableLock}>Disable</button>{/if}
  </div>
</div>

<div class="head" style="margin-top:22px">
  <h3>Encrypted secrets</h3>
  <span class="badge {dpapi ? 'safe' : 'caution'}">{dpapi ? "DPAPI active" : "unprotected"}</span>
</div>
<div class="card">
  {#if secrets.length}
    {#each secrets as s (s.name)}
      <div class="srow">
        <i class="ti ti-key" style="color:var(--safe)"></i>
        <span class="sname">{s.name}</span>
        <span class="muted sval">••••••••</span>
        <span class="dim">updated {s.updated_at}</span>
        <button class="btn ghost" on:click={() => removeSecret(s.name)}><i class="ti ti-trash"></i></button>
      </div>
    {/each}
  {:else}
    <p class="muted" style="margin:0 0 12px">No secrets stored yet.</p>
  {/if}
  <div class="addrow">
    <input placeholder="name (e.g. flutterwave_secret)" bind:value={newName} />
    <input placeholder="value" type="password" bind:value={newValue} />
    <button class="btn primary" on:click={addSecret}>Encrypt &amp; store</button>
  </div>
  <p class="dim" style="margin:10px 0 0">Values are encrypted with your Windows account key and never shown again or sent to the model.</p>
</div>

<div class="head" style="margin-top:22px"><h3>Connectors</h3></div>
<div class="card flags">
  <div class="frow">
    <i class="ti ti-cash" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Flutterwave</b><span class="muted">{fwStatus} · read-only payments, key encrypted (DPAPI)</span></div>
    <span class="badge {fwStatus.startsWith('Connected') ? 'safe' : 'caution'}">{fwStatus.startsWith('Connected') ? 'live' : 'set key'}</span>
  </div>
  <div class="addrow" style="display:flex;gap:8px;margin-top:6px">
    <input style={SEL + "flex:1;"} type="password" placeholder="Flutterwave secret key (FLWSECK-…)" bind:value={fwKey} />
    <button class="btn" on:click={testFw}>Test</button>
    <button class="btn primary" on:click={saveFw}>Save key</button>
  </div>
</div>
<div class="card flags" style="margin-top:12px">
  <div class="frow">
    <i class="ti ti-scale" style="color:var(--accent-2)"></i>
    <div class="ft"><b>Estoppel</b><span class="muted">{estStatus} · full DB read + send mail/newsletters as Estoppel (Resend)</span></div>
    <span class="badge {estStatus.startsWith('Connected') ? 'safe' : 'caution'}">{estStatus.startsWith('Connected') ? 'live' : 'set keys'}</span>
  </div>
  <div class="addrow" style="display:flex;gap:8px;margin-top:6px">
    <input style={SEL + "flex:1;"} type="password" placeholder="Estoppel Postgres connection (estoppel_pg)" bind:value={estPg} />
  </div>
  <div class="addrow" style="display:flex;gap:8px;margin-top:6px">
    <input style={SEL + "flex:1;"} type="password" placeholder="Estoppel Resend API key (estoppel_resend_key)" bind:value={estResend} />
    <button class="btn" on:click={testEst}>Test</button>
    <button class="btn primary" on:click={saveEst}>Save</button>
  </div>
</div>
<div class="conns" style="margin-top:12px">
  {#each [["Gmail","ti-mail"],["Social","ti-speakerphone"],["Calendar","ti-calendar"]] as [name, ic]}
    <div class="card conn"><i class="ti {ic}"></i><b>{name}</b><span class="badge caution">needs OAuth</span></div>
  {/each}
</div>

<style>
  .head { display: flex; align-items: center; gap: 10px; }
  .head h3 { margin: 0 0 14px; font-size: 16px; }
  .head .badge { margin-bottom: 14px; }
  .flags, .card { margin-bottom: 0; }
  .frow { display: flex; align-items: center; gap: 14px; padding: 10px 0; }
  .frow:not(:last-child) { border-bottom: 1px solid var(--line); }
  .frow > i { font-size: 20px; }
  .ft { flex: 1; display: flex; flex-direction: column; }
  .ft span { font-size: 12.5px; }
  .srow { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .sname { font-weight: 500; } .sval { flex: 1; }
  .dim { font-size: 11.5px; color: var(--text-3); }
  .addrow { display: flex; gap: 8px; margin-top: 14px; }
  .addrow input { flex: 1; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 10px; outline: none; }
  .addrow input:focus { border-color: var(--accent); }
  .seg { display: flex; gap: 4px; background: var(--bg-1); border: 1px solid var(--line); border-radius: 8px; padding: 3px; }
  .seg button { padding: 6px 14px; border-radius: 6px; font-size: 12.5px; color: var(--text-2); }
  .seg button.on { background: var(--accent-bg); color: var(--accent-2); }
  .trustlist { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .trust { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line); font-size: 12px; font-family: ui-monospace, monospace; }
  .trust button { color: var(--text-3); display: grid; place-items: center; }
  .trust button:hover { color: var(--danger); }
  .conns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .conn { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .conn i { font-size: 22px; color: var(--accent); }
</style>
