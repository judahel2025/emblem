<script>
  // Secure developer-credential dialog for apps with no Composio-managed auth
  // (e.g. X/Twitter). Used both from the Connectors screen and from chat when
  // the agent's connect_app hits a credentials.needed action.
  //
  // Props: toolkit (slug), fields ([{ name, label, hint }]).
  // Emits: "connected" (after the connect link is opened, so callers can start
  //         polling) and "close".
  import { createEventDispatcher } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { brandLogo, MONO_LOGOS, logoUrl } from "../lib/logos.js";

  export let toolkit = "";
  export let fields = [];
  export let label = "";

  const dispatch = createEventDispatcher();

  const META = {
    twitter: { icon: "ti-brand-x", label: "Twitter / X" },
    x: { icon: "ti-brand-x", label: "Twitter / X" },
  };
  $: cm = META[toolkit] || { icon: "ti-plug", label: label || toolkit.replace(/_/g, " ") };

  // Some apps require a specific redirect/callback URL on their OAuth allow list
  // or the connect round-trip fails. Surface it so the user can paste it in.
  const REDIRECT_URI = {
    twitter: "https://backend.composio.dev/api/v1/auth-apps/add",
    x: "https://backend.composio.dev/api/v1/auth-apps/add",
  };
  $: redirectUri = REDIRECT_URI[toolkit] || "";

  let values = {};
  let saving = false, error = "", copied = false;

  function copyRedirect() {
    try { navigator.clipboard.writeText(redirectUri); copied = true; setTimeout(() => (copied = false), 1600); } catch {}
  }

  function imgFallback(e) {
    const img = e.currentTarget;
    img.style.display = "none";
    const icon = img.nextElementSibling;
    if (icon) icon.style.display = "";
  }

  async function submit() {
    if (!toolkit || saving) return;
    const missing = fields.filter((f) => !String(values[f.name] || "").trim());
    if (missing.length) { error = `Please fill in: ${missing.map((f) => f.label).join(", ")}`; return; }
    saving = true; error = "";
    try {
      const r = await api.connectionCredentials(toolkit, values);
      if (r.ok && r.url) {
        window.open(r.url, "_blank", "noopener,width=600,height=760");
        dispatch("connected", { toolkit });
        close();
      } else error = r.error || "Those credentials were rejected. Double-check and try again.";
    } catch { error = "Couldn't save the credentials. Try again."; }
    saving = false;
  }

  function close() { dispatch("close"); }
</script>

<div class="veil" on:click|self={close} transition:fade={{ duration: 150 }} role="presentation">
  <div class="consent glass gloss cred" transition:fly={{ y: 12, duration: 220 }}>
    <div class="consent-marks">
      <span class="cmark app" class:mono={MONO_LOGOS.has(toolkit)}>
        {#if brandLogo(toolkit)}{@html brandLogo(toolkit)}
        {:else}<img class="brandimg" src={logoUrl(toolkit)} alt={cm.label} on:error={imgFallback} /><i class="ti {cm.icon}" style="display:none"></i>{/if}
      </span>
    </div>
    <h3>Connect your {cm.label}</h3>
    <p>{cm.label} needs its own developer app. Paste the keys from your {cm.label} developer
       dashboard once, Emblem saves them securely so you'll never have to enter them again.</p>
    <div class="cred-fields">
      {#each fields as f (f.name)}
        <label class="cred-field">
          <span class="cred-label">{f.label}</span>
          <input type="password" autocomplete="off" spellcheck="false"
            bind:value={values[f.name]} placeholder={f.hint || f.label} />
          {#if f.hint}<span class="cred-hint">{f.hint}</span>{/if}
        </label>
      {/each}
    </div>
    {#if redirectUri}
      <div class="cred-redirect">
        <span class="cred-label">Also add this callback URL to your app's OAuth allow list:</span>
        <div class="redirect-row">
          <code>{redirectUri}</code>
          <button type="button" class="copy" on:click={copyRedirect}>{copied ? "Copied" : "Copy"}</button>
        </div>
      </div>
    {/if}
    {#if error}<p class="cred-error">{error}</p>{/if}
    <div class="consent-btns">
      <button class="btn ghost" on:click={close} disabled={saving}>Cancel</button>
      <button class="btn primary" on:click={submit} disabled={saving}>
        {#if saving}<span class="spin"></span> Connecting…{:else}Save & connect{/if}
      </button>
    </div>
  </div>
</div>

<style>
  .veil {
    position: fixed; inset: 0; z-index: 200; display: grid; place-items: center;
    background: rgba(6, 9, 20, 0.6); backdrop-filter: blur(4px); padding: 20px;
  }
  .consent {
    width: min(440px, calc(100vw - 40px)); padding: 26px 26px 22px;
    border-radius: var(--r-lg, 18px); box-shadow: var(--edge-blue, 0 12px 48px rgba(0,0,0,.5));
  }
  .consent-marks { display: flex; justify-content: flex-start; margin-bottom: 14px; }
  .cmark {
    width: 46px; height: 46px; display: grid; place-items: center;
    border-radius: 12px; background: var(--s1); border: 1px solid var(--border);
  }
  .cmark :global(svg) { width: 26px; height: 26px; }
  .cmark.mono :global(svg) { color: var(--text); }
  .cmark .brandimg { width: 26px; height: 26px; object-fit: contain; }
  .consent.cred { text-align: left; }
  .consent.cred h3 { text-align: left; font-size: 18px; font-weight: 500; margin: 0 0 8px; color: var(--text); }
  .consent.cred p { font-size: 13px; line-height: 1.5; color: var(--text-2, var(--text)); margin: 0 0 18px; }
  .cred-fields { display: flex; flex-direction: column; gap: 14px; margin: 4px 0 16px; }
  .cred-field { display: flex; flex-direction: column; gap: 5px; }
  .cred-label { font-size: 12.5px; font-weight: 500; color: var(--text); }
  .cred-field input {
    width: 100%; background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-sm, 10px); padding: 9px 12px; font-size: 13px; color: var(--text);
    outline: none; font-family: var(--mono, inherit); transition: border-color var(--t-fast, .15s);
  }
  .cred-field input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg, rgba(62,99,221,.2)); }
  .cred-hint { font-size: 11.5px; color: var(--text-3, var(--text-2)); line-height: 1.4; }
  .cred-error { font-size: 12.5px; color: var(--danger, #E5484D); margin: 0 0 14px; }
  .cred-redirect { margin: 0 0 16px; display: flex; flex-direction: column; gap: 6px; }
  .redirect-row { display: flex; align-items: center; gap: 8px; }
  .redirect-row code {
    flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; background: var(--s1);
    border: 1px solid var(--border); border-radius: var(--r-sm, 10px); padding: 7px 10px;
    font-family: var(--mono, monospace); font-size: 11.5px; color: var(--text-2, var(--text));
  }
  .redirect-row .copy {
    flex: none; background: var(--s2, var(--s1)); border: 1px solid var(--border);
    border-radius: var(--r-sm, 10px); padding: 7px 12px; font-size: 12px; color: var(--text);
    cursor: pointer; transition: border-color var(--t-fast, .15s);
  }
  .redirect-row .copy:hover { border-color: var(--accent); }
  .consent-btns { display: flex; gap: 10px; justify-content: center; }
  .consent-btns .btn { flex: 1; }
  .spin {
    display: inline-block; width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.4);
    border-top-color: #fff; border-radius: 50%; animation: cred-spin .7s linear infinite; vertical-align: -2px;
  }
  @keyframes cred-spin { to { transform: rotate(360deg); } }
</style>
