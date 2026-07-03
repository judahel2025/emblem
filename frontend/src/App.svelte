<script>
  import { onMount, onDestroy } from "svelte";
  import { refresh, loadBriefing, loadConversation, loadMe, me, voiceState, brainReady, appView } from "./lib/store.js";
  import { api } from "./lib/api.js";
  import ChatView from "./components/ChatView.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import Toast from "./components/Toast.svelte";
  import Landing from "./screens/Landing.svelte";
  import Login from "./screens/Login.svelte";
  import Onboarding from "./screens/Onboarding.svelte";
  import Connectors from "./screens/Connectors.svelte";
  import Pages from "./screens/Pages.svelte";
  import Calendar from "./screens/Calendar.svelte";
  import Automations from "./screens/Automations.svelte";
  import VoiceLive from "./screens/VoiceLive.svelte";
  import Orb from "./components/Orb.svelte";
  import { auth } from "./lib/supabase.js";

  let showVoice = false;

  let engineUp = false;
  let engineFailed = false;
  let showSettings = false;
  let timer;

  // If we just returned from Google OAuth, capture the session before first render logic.
  if (typeof window !== "undefined" && auth.handleRedirect()) {
    try { localStorage.setItem("emblem_entered", "1"); } catch {}
  }

  const ls = (k) => typeof localStorage !== "undefined" && localStorage.getItem(k) === "1";
  let entered = ls("emblem_entered");
  let loggedIn = auth.isLoggedIn();
  // Optimistic hint only — the server's profiles.onboarded is the truth, reconciled in boot().
  let onboarded = ls("emblem_onboarded");
  let identityReady = !loggedIn;   // logged-in users wait for /api/me before routing

  const NAV = [
    { id: "chat", label: "Chat", icon: "ti-message-2" },
    { id: "connect", label: "Connections", icon: "ti-plug-connected" },
    { id: "pages", label: "Pages", icon: "ti-file-text" },
    { id: "calendar", label: "Calendar", icon: "ti-calendar" },
    { id: "automations", label: "Automations", icon: "ti-bolt" },
  ];

  function enterApp() { entered = true; try { localStorage.setItem("emblem_entered", "1"); } catch {} }
  async function onLogin() {
    loggedIn = true;
    identityReady = false;
    await syncIdentity();
    boot();
  }
  function onOnboarded() { onboarded = true; appView.set("connect"); }
  function signOut() { auth.signOut(); loggedIn = false; appView.set("chat"); }

  // Server truth for onboarding — localStorage is just a hint that can go stale
  // (cleared cache, new device, or a failed save in an old build).
  async function syncIdentity() {
    const my = await loadMe(true);
    if (my?.user_id) {
      onboarded = !!my.onboarded;
      try { localStorage.setItem("emblem_onboarded", onboarded ? "1" : "0"); } catch {}
    }
    identityReady = true;
  }

  // status label mirrors Clicky's status text
  $: statusLabel = {
    idle: "Ready",
    listening: "Listening",
    thinking: "Processing",
    speaking: "Responding"
  }[$voiceState] ?? "Ready";

  async function waitForEngine() {
    for (let i = 0; i < 40; i++) {
      try { await api.health(); engineUp = true; return; } catch {}
      await new Promise(r => setTimeout(r, 1200));
    }
    engineFailed = true;
  }

  async function boot() {
    if (!loggedIn || timer) return;   // workspace boot only, once
    await waitForEngine();
    if (!engineUp) return;
    refresh();
    loadConversation();
    loadBriefing();
    timer = setInterval(refresh, 6000);
  }

  function onSessionExpired() {
    if (loggedIn) { signOut(); }
  }

  onMount(() => {
    window.addEventListener("emblem:session-expired", onSessionExpired);
    if (loggedIn) { syncIdentity().then(boot); }
  });
  onDestroy(() => {
    clearInterval(timer);
    window.removeEventListener("emblem:session-expired", onSessionExpired);
  });
</script>

{#if !entered}
  <Landing on:enter={enterApp} />
{:else if !loggedIn}
  <Login on:done={onLogin} />
{:else if !identityReady}
  <div class="splash">
    <div class="splash-v pulse">E</div>
    <p class="splash-sub">One moment…</p>
  </div>
{:else if !onboarded}
  <Onboarding on:done={onOnboarded} />
{:else}
  <div class="app">
    <!-- Left rail -->
    <aside class="rail">
      <div class="rail-brand"><span class="mark">V</span> Emblem</div>
      <nav class="rail-nav">
        {#each NAV as n}
          <button class="rail-item" class:active={$appView === n.id} on:click={() => appView.set(n.id)}>
            <i class="ti {n.icon}"></i> {n.label}
          </button>
        {/each}
      </nav>
      <div class="rail-foot">
        <button class="rail-item" on:click={() => showSettings = true}><i class="ti ti-settings"></i> Settings</button>
        <button class="rail-item" on:click={signOut}><i class="ti ti-logout"></i> Sign out</button>
        <div class="who">{auth.email()}</div>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <span class="status-label">{statusLabel}</span>
        <span class="status-dot" class:ready={$brainReady} class:notready={!$brainReady}></span>
      </header>
      <main class="main">
        {#if $appView === "chat"}<ChatView />
        {:else if $appView === "connect"}<Connectors />
        {:else if $appView === "pages"}<Pages />
        {:else if $appView === "calendar"}<Calendar />
        {:else if $appView === "automations"}<Automations />{/if}
      </main>
    </div>

    <button class="voice-fab" on:click={() => showVoice = true} title="Talk to Emblem">
      <i class="ti ti-microphone"></i>
    </button>

    {#if showVoice}<VoiceLive on:close={() => showVoice = false} />{/if}
    {#if showSettings}
      <SettingsPanel on:close={() => showSettings = false} />
    {/if}
  </div>
{/if}

<Toast />

<style>
  .shell { display: flex; flex-direction: column; height: 100vh; background: var(--bg); overflow: hidden; }

  /* Top bar — mirrors Clicky's panel header */
  .topbar {
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--s1);
    border-bottom: 1px solid var(--border);
  }
  .topbar-left { display: flex; align-items: center; gap: 8px; }
  .topbar-right { display: flex; align-items: center; gap: 10px; }

  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--border-strong);
    transition: background 0.3s, box-shadow 0.3s;
    flex-shrink: 0;
  }
  .status-dot.ready { background: var(--safe); box-shadow: 0 0 6px rgba(52,211,153,0.5); }
  .status-dot.notready { background: var(--danger); }

  .brand { font-size: 14px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .status-label { font-size: 12px; color: var(--text-3); font-weight: 500; }

  .icon-btn {
    width: 28px; height: 28px;
    border-radius: 6px;
    display: grid; place-items: center;
    color: var(--text-3);
    transition: background 0.15s, color 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--s2); color: var(--text-2); }

  .main { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }

  /* Workspace shell with left rail */
  .app { display: flex; height: 100vh; background: var(--bg); overflow: hidden; }
  .rail { width: 210px; flex-shrink: 0; background: var(--s1); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; padding: 16px 12px; }
  .rail-brand { display: flex; align-items: center; gap: 9px; font-size: 17px; font-weight: 700;
    padding: 4px 8px 16px; color: var(--text); }
  .rail-brand .mark { width: 24px; height: 24px; border-radius: 7px; background: var(--accent); color: var(--accent-t);
    display: grid; place-items: center; font-weight: 800; font-size: 14px; }
  .rail-nav { display: flex; flex-direction: column; gap: 2px; }
  .rail-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 9px 10px;
    border-radius: 9px; font-size: 14px; font-weight: 500; color: var(--text-2); background: none; border: none;
    cursor: pointer; transition: all .12s; }
  .rail-item:hover { background: var(--s2); color: var(--text); }
  .rail-item.active { background: var(--accent); color: var(--accent-t); font-weight: 700; }
  .rail-item i { font-size: 18px; }
  .rail-foot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 12px; }
  .who { font-size: 11px; color: var(--text-3); padding: 8px 10px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .workspace .topbar { justify-content: flex-end; gap: 8px; }
  .voice-fab { position: absolute; right: 26px; bottom: 26px; width: 58px; height: 58px; border-radius: 50%;
    background: var(--accent); color: var(--accent-t); border: none; cursor: pointer; font-size: 24px;
    display: grid; place-items: center; box-shadow: 0 10px 30px rgba(233,220,62,0.55); z-index: 30;
    transition: transform .15s; }
  .voice-fab:hover { transform: scale(1.06); }

  /* Splash */
  .splash {
    height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; text-align: center;
    background: var(--bg);
  }
  .splash-v {
    width: 56px; height: 56px;
    border-radius: 14px;
    border: 1.5px solid var(--accent);
    color: var(--accent-t);
    font-size: 28px; font-weight: 800;
    display: grid; place-items: center;
    box-shadow: 0 0 24px rgba(37,99,235,0.22);
    margin-bottom: 4px;
  }
  .splash-v.pulse { animation: breathe-glow 1.8s ease-in-out infinite; }
  .splash h1 { margin: 0; font-size: 18px; color: var(--text); }
  .splash-sub { margin: 0; color: var(--text-3); font-size: 13px; }
  .retry-btn {
    margin-top: 8px;
    padding: 9px 22px;
    background: var(--accent);
    color: white;
    border-radius: 20px;
    font-size: 13px; font-weight: 500;
    transition: background 0.15s;
    border: none;
    cursor: pointer;
  }
  .retry-btn:hover { background: var(--accent-h); }
</style>
