<script>
  // Sidebar: fixed New-chat at top, ONE scroll region (nav + recent chats) in the
  // middle so nothing can ever be pushed off-screen, and a PINNED profile at the
  // bottom that never scrolls and opens Settings / Help / Sign out.
  import { createEventDispatcher, onDestroy } from "svelte";
  import { slide, fade } from "svelte/transition";
  import { threads, activeThread, appView, openThread, openLegacy, newChat,
           renameThread, deleteThread, brainReady, connectedApps, me, notifications } from "../lib/store.js";
  import { auth } from "../lib/supabase.js";
  import { WORKSPACES } from "../lib/workspaces.js";
  import ThemeToggle from "./ThemeToggle.svelte";
  import Logo from "./Logo.svelte";

  export let collapsed = false;      // desktop rail
  export let drawerOpen = false;     // mobile off-canvas drawer (open)

  const dispatch = createEventDispatcher();

  // On mobile the sidebar is a full drawer (never a rail); `rail` is the desktop-only
  // collapsed state that hides labels. This keeps a persisted desktop collapse from
  // showing collapsed content inside the mobile drawer.
  let innerWidth = 9999;
  $: isMobile = innerWidth <= 768;
  $: rail = collapsed && !isMobile;

  const NAV = [
    { id: "notifications", label: "Notifications", icon: "ti-bell" },
    { id: "connect",     label: "Connections", icon: "ti-plug-connected" },
    { id: "pages",       label: "Notes",       icon: "ti-file-text" },
    { id: "calendar",    label: "Calendar",    icon: "ti-calendar" },
    { id: "automations", label: "Automations", icon: "ti-bolt" },
  ];

  let renamingId = null;
  let renameValue = "";
  let profileMenu = false;

  // Workspace nav items (one per connected app that has a workspace screen).
  $: wsItems = $connectedApps.filter((s) => WORKSPACES[s]);
  $: displayName = $me.display_name || auth.email() || "You";
  $: initial = (displayName || "E").trim().slice(0, 1).toUpperCase();

  function startRename(t) { renamingId = t.id; renameValue = t.title; }
  function commitRename() {
    if (renamingId && renameValue.trim()) renameThread(renamingId, renameValue.trim());
    renamingId = null;
  }
  function pick(fn) { profileMenu = false; fn(); }

  // Close the profile menu on any outside click.
  function onWinClick(e) {
    if (profileMenu && !e.target.closest(".foot")) profileMenu = false;
  }
  if (typeof window !== "undefined") window.addEventListener("click", onWinClick, true);
  onDestroy(() => { if (typeof window !== "undefined") window.removeEventListener("click", onWinClick, true); });
</script>

<svelte:window bind:innerWidth />

<aside class="sidebar" class:collapsed={rail} class:open={drawerOpen} data-tour="sidebar">
  <!-- ── Fixed top: brand + New chat. When railed, only the toggle shows (centered)
          so it's never clipped. ── -->
  <div class="top">
    {#if !rail}
      <button class="brand" on:click={newChat} title="Emblem">
        <span class="mark"><Logo size={26} /></span>
        <span class="name">Emblem</span>
      </button>
    {/if}
    <button class="icon-btn toggle" on:click={() => collapsed = !collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="Toggle sidebar">
      <i class="ti {collapsed ? 'ti-layout-sidebar-filled' : 'ti-layout-sidebar'}"></i>
    </button>
  </div>

  <button class="new-chat" on:click={newChat} data-tour="new-chat">
    <i class="ti ti-plus"></i>
    {#if !rail}<span>New chat</span>{/if}
  </button>

  <!-- ── The ONE scroll region: nav + recent chats. Nothing gets cut off; you
          just scroll. ── -->
  <div class="scroll">
    <nav class="nav">
      {#each NAV as n}
        <button class="nav-item" class:active={$appView === n.id}
                on:click={() => appView.set(n.id)} data-tour="nav-{n.id}" title={n.label}>
          <span class="ni-ic">
            <i class="ti {n.icon}"></i>
            {#if n.id === "notifications" && $notifications.unread > 0}
              <span class="ni-badge" class:dot={rail}>{rail ? "" : ($notifications.unread > 99 ? "99+" : $notifications.unread)}</span>
            {/if}
          </span>
          {#if !rail}
            <span>{n.label}</span>
            {#if n.id === "notifications" && $notifications.unread > 0}
              <span class="ni-count">{$notifications.unread > 99 ? "99+" : $notifications.unread}</span>
            {/if}
          {/if}
        </button>
      {/each}
      {#each wsItems as s (s)}
        <button class="nav-item" class:active={$appView === `workspace:${s}`}
                on:click={() => appView.set(`workspace:${s}`)} title={WORKSPACES[s].label}>
          <i class="ti {WORKSPACES[s].icon}"></i>
          {#if !rail}<span>{WORKSPACES[s].label}</span>{/if}
        </button>
      {/each}
    </nav>

    {#if !rail}
      <div class="threads">
        {#if $threads.items.length || $threads.legacy_count}
          <p class="section-label">Recent</p>
        {/if}
        {#each $threads.items as t (t.id)}
          <div class="thread-row" class:active={$activeThread === t.id}>
            {#if renamingId === t.id}
              <!-- svelte-ignore a11y-autofocus -->
              <input class="rename" bind:value={renameValue} autofocus
                     on:blur={commitRename}
                     on:keydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renamingId = null; }} />
            {:else}
              <button class="thread-btn" on:click={() => openThread(t.id)} title={t.title}>
                <span class="t-title">{t.title}</span>
              </button>
              <span class="row-actions">
                <button class="mini" on:click={() => startRename(t)} aria-label="Rename chat"><i class="ti ti-pencil"></i></button>
                <button class="mini danger" on:click={() => deleteThread(t.id)} aria-label="Delete chat"><i class="ti ti-trash"></i></button>
              </span>
            {/if}
          </div>
        {/each}
        {#if $threads.legacy_count}
          <div class="thread-row" class:active={$activeThread === "legacy"}>
            <button class="thread-btn" on:click={openLegacy}>
              <span class="t-title dim">Earlier</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- ── Pinned profile: never scrolls; opens Settings / Help / Sign out ── -->
  <div class="foot">
    {#if profileMenu}
      <div class="profile-menu glass gloss" transition:fade={{ duration: 120 }}>
        <button class="pm-item" on:click={() => pick(() => dispatch("settings"))}>
          <i class="ti ti-settings"></i> Settings
        </button>
        <button class="pm-item" on:click={() => pick(() => appView.set("help"))}>
          <i class="ti ti-help-circle"></i> Help
        </button>
        <div class="pm-row">
          <span><i class="ti ti-palette"></i> Theme</span>
          <ThemeToggle />
        </div>
        <div class="pm-sep"></div>
        <button class="pm-item danger" on:click={() => pick(() => dispatch("signout"))}>
          <i class="ti ti-logout"></i> Sign out
        </button>
      </div>
    {/if}
    <button class="profile-btn" class:open={profileMenu} on:click={() => profileMenu = !profileMenu}
            title={displayName} aria-haspopup="true" aria-expanded={profileMenu}>
      <span class="avatar">{initial}<span class="status-dot" class:ready={$brainReady}></span></span>
      {#if !rail}
        <span class="pinfo">
          <span class="pname">{displayName}</span>
          <span class="psub">{$brainReady ? "Online" : "Connecting…"}</span>
        </span>
        <i class="ti ti-dots-vertical pchev"></i>
      {/if}
    </button>
  </div>
</aside>

<style>
  .sidebar {
    width: 262px; flex-shrink: 0; height: 100%;
    display: flex; flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--s1);
    padding: 10px;
    transition: width var(--t-normal);
  }
  .sidebar.collapsed { width: 62px; }

  .top { display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 10px; flex-shrink: 0; }
  /* Railed: only the toggle remains, centered — never clipped. */
  .sidebar.collapsed .top { justify-content: center; }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; color: var(--text); cursor: pointer; }
  .mark { display: grid; place-items: center; color: var(--accent-ink); }
  .icon-btn {
    width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
    color: var(--text-3); font-size: 17px; cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .icon-btn:hover { background: var(--s2); color: var(--text); }

  .new-chat {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 12px; margin: 0 2px 8px; flex-shrink: 0;
    border-radius: var(--r-pill);
    background: var(--accent-grad); color: var(--accent-t);
    font-size: 14px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 12px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast);
  }
  .new-chat:hover { filter: brightness(1.07); box-shadow: 0 4px 16px var(--accent-glow); }
  .new-chat i { font-size: 17px; }

  /* THE scroll region — nav + chats together; the only thing that scrolls. */
  .scroll {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 0 4px;
    scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent;
  }
  .scroll::-webkit-scrollbar { width: 8px; }
  .scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }

  .nav { display: flex; flex-direction: column; gap: 1px; padding-bottom: 6px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 9px 10px; border-radius: 10px;
    font-size: 13.5px; font-weight: 500; color: var(--text-2);
    cursor: pointer; transition: background var(--t-fast), color var(--t-fast);
  }
  .sidebar.collapsed .nav-item { justify-content: center; padding: 9px 0; }
  .nav-item:hover { background: var(--s2); color: var(--text); }
  /* Selected = filled accent (black in light, milk in dark), and it STAYS. */
  .nav-item.active { background: var(--accent); color: var(--accent-t); font-weight: 600; }
  .nav-item.active:hover { background: var(--accent); color: var(--accent-t); filter: brightness(1.05); }
  .nav-item.active i { color: var(--accent-t); }
  .nav-item i { font-size: 18px; flex-shrink: 0; }
  .ni-ic { position: relative; display: grid; place-items: center; }
  .ni-count {
    margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: var(--r-pill);
    background: var(--accent-grad); color: var(--accent-t); font-size: 11px; font-weight: 700;
    display: grid; place-items: center;
  }
  .nav-item.active .ni-count { background: var(--accent-t); color: var(--accent); }
  /* collapsed: a small dot on the bell */
  .ni-badge.dot {
    position: absolute; top: -3px; right: -3px; width: 9px; height: 9px; padding: 0;
    border-radius: 50%; background: var(--danger); border: 2px solid var(--s1);
  }
  .ni-badge:not(.dot) { display: none; }

  .threads { padding: 6px 0 0; border-top: 1px solid var(--divider); }
  .section-label {
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-3); margin: 0 0 4px; padding: 6px 8px 4px;
  }
  .thread-row {
    display: flex; align-items: center; border-radius: 10px; position: relative;
    transition: background var(--t-fast);
  }
  .thread-row:hover { background: var(--s2); }
  /* Selected chat = filled accent, stays highlighted while it's the open thread. */
  .thread-row.active { background: var(--accent); font-weight: 600; }
  .thread-btn {
    flex: 1; min-width: 0; text-align: left; padding: 6px 10px;
    font-size: 13.5px; line-height: 1.5; color: var(--text-2); cursor: pointer;
  }
  .thread-row.active .thread-btn { color: var(--accent-t); }
  .thread-row.active .t-title.dim { color: var(--accent-t); opacity: 0.85; }
  .thread-row.active .mini { color: var(--accent-t); opacity: 0.8; }
  .thread-row.active .mini:hover { background: rgba(128,128,128,0.25); color: var(--accent-t); opacity: 1; }
  .t-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-title.dim { color: var(--text-3); font-style: italic; }
  .row-actions { display: none; align-items: center; gap: 2px; padding-right: 6px; }
  .thread-row:hover .row-actions { display: flex; }
  .mini {
    width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
    color: var(--text-3); font-size: 14px; cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .mini:hover { background: var(--s3); color: var(--text); }
  .mini.danger:hover { color: var(--danger); }
  .rename {
    flex: 1; margin: 4px; padding: 5px 8px; font-size: 13px;
    background: var(--bg); border: 1px solid var(--accent); border-radius: 8px;
    color: var(--text); outline: none;
  }

  /* Pinned profile — never scrolls, always at the bottom. */
  .foot { flex-shrink: 0; padding-top: 8px; margin-top: 4px; border-top: 1px solid var(--divider); position: relative; }
  .profile-btn {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 8px; border-radius: 12px; cursor: pointer;
    transition: background var(--t-fast);
  }
  .profile-btn:hover, .profile-btn.open { background: var(--s2); }
  .sidebar.collapsed .profile-btn { justify-content: center; padding: 8px 0; }
  .avatar {
    position: relative; width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-size: 15px; font-weight: 700;
  }
  .status-dot {
    position: absolute; bottom: -1px; right: -1px;
    width: 10px; height: 10px; border-radius: 50%; background: var(--danger);
    border: 2px solid var(--s1); transition: background var(--t-normal);
  }
  .status-dot.ready { background: var(--safe); }
  .pinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pname { font-size: 13.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .psub { font-size: 11px; color: var(--text-3); }
  .pchev { font-size: 17px; color: var(--text-3); flex-shrink: 0; }

  .profile-menu {
    position: absolute; bottom: calc(100% + 6px); left: 0; right: 0;
    border-radius: var(--r-lg); padding: 6px; box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column; gap: 1px; z-index: 20;
  }
  .pm-item {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 9px 11px; border-radius: 8px; font-size: 13.5px; font-weight: 500;
    color: var(--text-2); cursor: pointer; transition: background var(--t-fast), color var(--t-fast);
  }
  .pm-item:hover { background: var(--s2); color: var(--text); }
  .pm-item.danger:hover { color: var(--danger); }
  .pm-item i { font-size: 17px; }
  .pm-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 11px; font-size: 13.5px; color: var(--text-2); }
  .pm-row span { display: inline-flex; align-items: center; gap: 10px; }
  .pm-row i { font-size: 17px; }
  .pm-sep { height: 1px; background: var(--divider); margin: 4px 6px; }

  /* ── Mobile: off-canvas drawer, hidden until opened via the top-bar hamburger ── */
  @media (max-width: 768px) {
    .sidebar {
      position: fixed; top: 0; left: 0; height: 100%;
      width: 82vw; max-width: 300px;
      transform: translateX(-100%);
      transition: transform var(--t-normal);
      z-index: 100; box-shadow: var(--shadow-lg);
    }
    .sidebar.open { transform: translateX(0); }
    /* Always full content in the drawer — never a rail. */
    .sidebar.collapsed { width: 82vw; max-width: 300px; }
    /* The desktop collapse toggle is meaningless inside the drawer. */
    .top .toggle { display: none; }
    .top { justify-content: flex-start; }
  }
</style>
