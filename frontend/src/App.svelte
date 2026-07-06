<script>
  import { onMount, onDestroy } from "svelte";
  import { refresh, loadBriefing, loadConversation, loadMe, loadConnections, appView, showVoiceOverlay, showOperator, me,
           startNotifPolling, askNotifPermission, loadNotifications, activeThread, newChat,
           showReviewModal } from "./lib/store.js";
  import { fade } from "svelte/transition";
  import { api } from "./lib/api.js";
  import Logo from "./components/Logo.svelte";
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
  import Notifications from "./screens/Notifications.svelte";
  import AccountSettings from "./screens/AccountSettings.svelte";
  import { auth } from "./lib/supabase.js";
  import "./lib/theme.js";   // keeps data-theme live (toggle + OS changes)
  import TourOverlay from "./components/TourOverlay.svelte";
  import { startTour } from "./lib/tour.js";
  import WorkspaceHost from "./screens/workspaces/WorkspaceHost.svelte";
  import AdminConsole from "./screens/AdminConsole.svelte";
  import ReviewModal from "./components/ReviewModal.svelte";
  import NewsletterPrompt from "./components/NewsletterPrompt.svelte";

  let engineUp = false;
  let engineFailed = false;
  let timer;

  // Sidebar: desktop rail (persisted) + mobile off-canvas drawer (ephemeral).
  let collapsed = (typeof localStorage !== "undefined" && localStorage.getItem("emblem_sidebar_collapsed") === "1");
  let drawerOpen = false;
  $: try { localStorage.setItem("emblem_sidebar_collapsed", collapsed ? "1" : "0"); } catch {}
  // Navigating (nav item, thread, screen) closes the mobile drawer.
  appView.subscribe(() => { drawerOpen = false; });
  activeThread.subscribe(() => { drawerOpen = false; });

  // If we just returned from Google OAuth, capture the session before first render logic.
  if (typeof window !== "undefined" && auth.handleRedirect()) {
    try { localStorage.setItem("emblem_entered", "1"); } catch {}
  }

  const ls = (k) => typeof localStorage !== "undefined" && localStorage.getItem(k) === "1";
  let entered = ls("emblem_entered");
  let loggedIn = auth.isLoggedIn();
  // Optimistic hint only, the server's profiles.onboarded is the truth, reconciled in boot().
  let onboarded = ls("emblem_onboarded");
  let identityReady = !loggedIn;   // logged-in users wait for /api/me before routing

  function enterApp() { entered = true; try { localStorage.setItem("emblem_entered", "1"); } catch {} }
  function backToLanding() { entered = false; try { localStorage.setItem("emblem_entered", "0"); } catch {} }
  async function onLogin() {
    loggedIn = true;
    identityReady = false;
    await syncIdentity();
    boot();
  }
  // After meeting Emblem, the voice-guided tour shows them around, once.
  function onOnboarded() {
    onboarded = true;
    startTour();
  }
  function signOut() { auth.signOut(); loggedIn = false; appView.set("chat"); }

  // Server truth for onboarding, localStorage is just a hint that can go stale
  // (cleared cache, new device, or a failed save in an old build).
  async function syncIdentity() {
    const my = await loadMe(true);
    if (my?.user_id) {
      onboarded = !!my.onboarded;
      try { localStorage.setItem("emblem_onboarded", onboarded ? "1" : "0"); } catch {}
      // Existing members who never saw the tour get it once (captions-only if the
      // browser blocks un-gestured audio, Next still walks them through).
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

  // Weekly newsletter nudge, only for members who never decided, once a week,
  // and never racing the tour/briefing (short delay + onboarded check).
  let showNewsPrompt = false;
  async function maybeNewsPrompt() {
    try {
      const s = await api.newsletterState();
      if (s?.prompt && onboarded) {
        setTimeout(() => { showNewsPrompt = true; }, 2200);
      }
    } catch {}
  }

  async function boot() {
    if (!loggedIn || timer) return;   // workspace boot only, once
    await waitForEngine();
    if (!engineUp) return;
    refresh();
    loadConversation();
    loadBriefing();
    loadConnections();
    loadNotifications();
    startNotifPolling();
    askNotifPermission();
    maybeNewsPrompt();
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
  <Login on:done={onLogin} on:back={backToLanding} />
{:else if !identityReady}
  <div class="splash">
    <div class="splash-v pulse"><Logo size={44} /></div>
    <p class="splash-sub">One moment…</p>
    <span class="splash-by">Emblem by Quaniac</span>
  </div>
{:else if !onboarded}
  <Onboarding on:done={onOnboarded} />
{:else}
  <div class="app" class:drawer-open={drawerOpen}>
    <!-- Mobile top bar (≤768px only): hamburger opens the drawer, brand, new chat. -->
    <div class="mobilebar">
      <button class="mb-btn" on:click={() => (drawerOpen = !drawerOpen)} aria-label="Menu">
        <i class="ti ti-menu-2"></i>
      </button>
      <button class="mb-brand" on:click={() => { newChat(); }} aria-label="Emblem, new chat">
        <Logo size={22} /> <span>Emblem</span>
      </button>
      <button class="mb-btn" on:click={() => { newChat(); }} aria-label="New chat">
        <i class="ti ti-edit"></i>
      </button>
    </div>

    {#if drawerOpen}
      <div class="backdrop" on:click={() => (drawerOpen = false)} transition:fade={{ duration: 150 }}
           role="presentation"></div>
    {/if}

    <!-- Everyone gets the Account screen (profile, memory, master instructions);
         admins reach the operator/kernel panel from a button inside it. -->
    <Sidebar bind:collapsed {drawerOpen} on:settings={() => appView.set("account")} on:signout={signOut} />

    <main class="main">
      {#if $appView === "chat"}<ChatView />
      {:else if $appView === "connect"}<Connectors />
      {:else if $appView === "pages"}<Pages />
      {:else if $appView === "calendar"}<Calendar />
      {:else if $appView === "automations"}<Automations />
      {:else if $appView === "help"}<Help />
      {:else if $appView === "notifications"}<Notifications />
      {:else if $appView === "account"}<AccountSettings />
      {:else if $appView === "admin"}
        {#if $me?.is_admin}<AdminConsole />{:else}<ChatView />{/if}
      {:else if $appView.startsWith("workspace:")}
        <WorkspaceHost slug={$appView.slice(10)} />{/if}
    </main>

    {#if $showVoiceOverlay}<VoiceLive on:close={() => showVoiceOverlay.set(false)} />{/if}
    {#if $showOperator}
      <SettingsPanel on:close={() => showOperator.set(false)} />
    {/if}
    {#if $showReviewModal}<ReviewModal on:close={() => showReviewModal.set(false)} />{/if}
    {#if showNewsPrompt}<NewsletterPrompt on:close={() => (showNewsPrompt = false)} />{/if}
    <TourOverlay />
  </div>
{/if}

<Toast />

<style>
  .app { display: flex; height: 100vh; background: var(--bg); overflow: hidden; }
  .main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }

  /* Mobile top bar + drawer backdrop, hidden on desktop. */
  .mobilebar { display: none; }
  .backdrop { display: none; }

  @media (max-width: 768px) {
    .app { position: relative; }
    .mobilebar {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      position: fixed; top: 0; left: 0; right: 0; height: 52px; z-index: 80;
      padding: 0 10px; background: var(--s1); border-bottom: 1px solid var(--border);
    }
    .mb-btn {
      width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center;
      color: var(--text-2); font-size: 21px; cursor: pointer;
    }
    .mb-btn:active { background: var(--s2); }
    .mb-brand { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 500; color: var(--text); }
    .mb-brand :global(svg) { color: var(--accent-ink); }
    .main { padding-top: 52px; }
    .backdrop {
      display: block; position: fixed; inset: 0; z-index: 90;
      background: rgba(0, 0, 0, 0.5); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
    }
  }

  /* Splash */
  .splash {
    height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; text-align: center;
    background: var(--bg);
  }
  .splash-v {
    padding: 10px 16px;
    border-radius: 18px;
    display: grid; place-items: center;
    margin-bottom: 4px;
  }
  .splash-v.pulse { animation: breathe-glow 1.8s ease-in-out infinite; border-radius: var(--r-pill); }
  .splash h1 { margin: 0; font-size: 18px; color: var(--text); }
  .splash-sub { margin: 0; color: var(--text-3); font-size: 13px; }
  .splash-by { margin-top: 18px; font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
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
