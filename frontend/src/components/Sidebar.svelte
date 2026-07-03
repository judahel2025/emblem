<script>
  // ChatGPT-style sidebar: new chat, conversation threads, workspace nav, footer.
  import { createEventDispatcher } from "svelte";
  import { slide } from "svelte/transition";
  import { threads, activeThread, appView, openThread, openLegacy, newChat,
           renameThread, deleteThread, brainReady, connectedApps } from "../lib/store.js";
  import { auth } from "../lib/supabase.js";
  import { WORKSPACES } from "../lib/workspaces.js";
  import ThemeToggle from "./ThemeToggle.svelte";

  export let collapsed = false;

  const dispatch = createEventDispatcher();

  const NAV = [
    { id: "connect",     label: "Connections", icon: "ti-plug-connected" },
    { id: "pages",       label: "Pages",       icon: "ti-file-text" },
    { id: "calendar",    label: "Calendar",    icon: "ti-calendar" },
    { id: "automations", label: "Automations", icon: "ti-bolt" },
  ];

  let renamingId = null;
  let renameValue = "";

  function startRename(t) {
    renamingId = t.id;
    renameValue = t.title;
  }
  function commitRename() {
    if (renamingId && renameValue.trim()) renameThread(renamingId, renameValue.trim());
    renamingId = null;
  }
</script>

<aside class="sidebar" class:collapsed data-tour="sidebar">
  <div class="top">
    <button class="brand" on:click={() => { newChat(); }} title="Emblem">
      <span class="mark gloss">E</span>
      {#if !collapsed}<span class="name">Emblem</span>{/if}
    </button>
    <button class="icon-btn" on:click={() => collapsed = !collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      <i class="ti {collapsed ? 'ti-layout-sidebar-left-expand' : 'ti-layout-sidebar-left-collapse'}"></i>
    </button>
  </div>

  <button class="new-chat" on:click={newChat} data-tour="new-chat">
    <i class="ti ti-plus"></i>
    {#if !collapsed}<span>New chat</span>{/if}
  </button>

  {#if !collapsed}
    <div class="threads" transition:slide={{ duration: 150 }}>
      {#if $threads.items.length || $threads.legacy_count}
        <p class="section-label">Chats</p>
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
  {:else}
    <div class="threads"></div>
  {/if}

  <nav class="nav">
    {#each NAV as n}
      <button class="nav-item" class:active={$appView === n.id}
              on:click={() => appView.set(n.id)} data-tour="nav-{n.id}"
              title={n.label}>
        <i class="ti {n.icon}"></i>
        {#if !collapsed}<span>{n.label}</span>{/if}
      </button>
    {/each}
    {#each $connectedApps.filter((s) => WORKSPACES[s]) as s (s)}
      <button class="nav-item" class:active={$appView === `workspace:${s}`}
              on:click={() => appView.set(`workspace:${s}`)}
              title={WORKSPACES[s].label}>
        <i class="ti {WORKSPACES[s].icon}"></i>
        {#if !collapsed}<span>{WORKSPACES[s].label}</span>{/if}
      </button>
    {/each}
  </nav>

  <div class="foot">
    <button class="nav-item" on:click={() => dispatch("settings")} title="Settings">
      <i class="ti ti-settings"></i>
      {#if !collapsed}<span>Settings</span>{/if}
    </button>
    <button class="nav-item" on:click={() => dispatch("signout")} title="Sign out">
      <i class="ti ti-logout"></i>
      {#if !collapsed}<span>Sign out</span>{/if}
    </button>
    {#if !collapsed}
      <div class="foot-row">
        <span class="status-dot" class:ready={$brainReady} title={$brainReady ? "Online" : "Connecting"}></span>
        <span class="who">{auth.email() || ""}</span>
        <ThemeToggle />
      </div>
    {/if}
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

  .top { display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 10px; }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; color: var(--text); cursor: pointer; }
  .mark {
    width: 28px; height: 28px; border-radius: 9px;
    background: var(--accent-grad); color: var(--accent-t);
    display: grid; place-items: center; font-weight: 800; font-size: 15px;
    box-shadow: 0 2px 10px var(--accent-glow);
  }
  .icon-btn {
    width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
    color: var(--text-3); font-size: 17px; cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .icon-btn:hover { background: var(--s2); color: var(--text); }

  .new-chat {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 12px; margin: 0 2px 6px;
    border-radius: var(--r-pill);
    background: var(--accent-grad); color: var(--accent-t);
    font-size: 14px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 12px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast);
  }
  .new-chat:hover { filter: brightness(1.07); box-shadow: 0 4px 16px var(--accent-glow); }
  .new-chat i { font-size: 17px; }

  .threads { flex: 1; overflow-y: auto; min-height: 40px; padding: 4px 0;
    scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
  .section-label {
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-3); margin: 8px 8px 4px;
  }
  .thread-row {
    display: flex; align-items: center; border-radius: 10px; position: relative;
    transition: background var(--t-fast);
  }
  .thread-row:hover, .thread-row.active { background: var(--s2); }
  .thread-row.active { font-weight: 500; }
  .thread-btn {
    flex: 1; min-width: 0; text-align: left; padding: 8px 10px;
    font-size: 13.5px; color: var(--text-2); cursor: pointer;
  }
  .thread-row.active .thread-btn { color: var(--text); }
  .t-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-title.dim { color: var(--text-3); font-style: italic; }
  .row-actions {
    display: none; align-items: center; gap: 2px; padding-right: 6px;
  }
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

  .nav { display: flex; flex-direction: column; gap: 1px; padding-top: 8px; border-top: 1px solid var(--divider); }
  .nav-item {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 9px 10px; border-radius: 10px;
    font-size: 13.5px; font-weight: 500; color: var(--text-2);
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .sidebar.collapsed .nav-item { justify-content: center; padding: 9px 0; }
  .nav-item:hover { background: var(--s2); color: var(--text); }
  .nav-item.active { background: var(--accent-bg); color: var(--text); }
  .nav-item.active i { color: var(--accent-ink); }
  .nav-item i { font-size: 18px; flex-shrink: 0; }

  .foot { display: flex; flex-direction: column; gap: 1px; padding-top: 8px; margin-top: 4px; border-top: 1px solid var(--divider); }
  .foot-row { display: flex; align-items: center; gap: 8px; padding: 8px 8px 2px; }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); flex-shrink: 0;
    transition: background var(--t-normal); }
  .status-dot.ready { background: var(--safe); box-shadow: 0 0 6px var(--safe); }
  .who { flex: 1; font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
