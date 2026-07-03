<script>
  import { onMount, onDestroy } from "svelte";
  import { refresh, loadBriefing, loadConversation, loadMe, loadConnections, appView, showVoiceOverlay, me } from "./lib/store.js";
  import { api } from "./lib/api.js";
  import ChatView from "./components/ChatView.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toast from "./components/Toast.svelte";
  import Landing from "./screens/Landing.svelte";
  import Login from "./screens/Login.svelte";
  import Onboarding from "./screens/Onboarding.svelte";
  import Connectors from "./screens/Connectors.svelte";
  import Pages from "./screens/Pages.svelte";
  import Calendar from "./screens/Calendar.svelte";
  import Automations from "./screens/Automations.svelte";
  import VoiceLive from "./screens/VoiceLive.svelte";
  import Help from "./screens/Help.svelte";
  import AccountSettings from "./screens/AccountSettings.svelte";
  import { auth } from "./lib/supabase.js";
  import "./lib/theme.js";   // keeps data-theme live (toggle + OS changes)
  import TourOverlay from "./components/TourOverlay.svelte";
  import { startTour } from "./lib/tour.js";
  import WorkspaceHost from "./screens/workspaces/WorkspaceHost.svelte";

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

  function enterApp() { entered = true; try { localStorage.setItem("emblem_entered", "1"); } catch {} }
  async function onLogin() {
    loggedIn = true;
    identityReady = false;
    await syncIdentity();
    boot();
  }
  // After meeting Emblem, the voice-guided tour shows them around — once.
  function onOnboarded() {
    onboarded = true;
    startTour();
  }
  function signOut() { auth.signOut(); loggedIn = false; appView.set("chat"); }

  // Server truth for onboarding — localStorage is just a hint that can go stale
  // (cleared cache, new device, or a failed save in an old build).
  async function syncIdentity() {
    const my = await loadMe(true);
    if (my?.user_id) {
      onboarded = !!my.onboarded;
      try { localStorage.setItem("emblem_onboarded", onboarded ? "1" : "0"); } catch {}
      // Existing members who never saw the tour get it once (captions-only if the
      // browser blocks un-gestured audio — Next still walks them through).
      if (onboarded && !my.toured && !localStorage.getItem("emblem_toured")) {
        setTimeout(startTour, 600);
      }
    }
    identityReady = true;
  }

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
    loadConnections();
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
    <!-- Users get the Account screen (Stitch account_settings); the admin keeps the full panel. -->
    <Sidebar on:settings={() => $me.is_admin ? showSettings = true : appView.set("account")} on:signout={signOut} />

    <main class="main">
      {#if $appView === "chat"}<ChatView />
      {:else if $appView === "connect"}<Connectors />
      {:else if $appView === "pages"}<Pages />
      {:else if $appView === "calendar"}<Calendar />
      {:else if $appView === "automations"}<Automations />
      {:else if $appView === "help"}<Help />
      {:else if $appView === "account"}<AccountSettings />
      {:else if $appView.startsWith("workspace:")}
        <WorkspaceHost slug={$appView.slice(10)} />{/if}
    </main>

    {#if $showVoiceOverlay}<VoiceLive on:close={() => showVoiceOverlay.set(false)} />{/if}
    {#if showSettings}
      <SettingsPanel on:close={() => showSettings = false} />
    {/if}
    <TourOverlay />
  </div>
{/if}

<Toast />

<style>
  .app { display: flex; height: 100vh; background: var(--bg); overflow: hidden; }
  .main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }

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
    background: var(--accent-grad);
    color: var(--accent-t);
    font-size: 28px; font-weight: 800;
    display: grid; place-items: center;
    box-shadow: 0 0 24px var(--accent-glow);
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
