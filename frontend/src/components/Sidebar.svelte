<script>
  import { createEventDispatcher } from "svelte";
  import { messages, pendingCount, brainReady, clearConversations } from "../lib/store.js";

  const emit = createEventDispatcher();

  function newChat() {
    clearConversations();
  }
</script>

<aside class="sidebar">
  <!-- Logo -->
  <div class="logo">
    <div class="logo-mark">V</div>
    <span class="logo-name">Veyra</span>
  </div>

  <!-- New chat -->
  <button class="new-chat" on:click={newChat} title="New conversation">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    New chat
  </button>

  <!-- Status indicators -->
  <div class="status-section">
    <div class="status-row">
      <span class="status-dot" class:green={$brainReady} class:red={!$brainReady}></span>
      <span class="status-label">{$brainReady ? "Brain online" : "No AI key"}</span>
    </div>
    {#if $pendingCount > 0}
      <div class="status-row warn">
        <span class="status-dot amber pulse"></span>
        <span class="status-label">{$pendingCount} approval{$pendingCount === 1 ? "" : "s"} pending</span>
      </div>
    {/if}
  </div>

  <div class="spacer"></div>

  <!-- Settings -->
  <button class="icon-btn" on:click={() => emit("settings")} title="Settings">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.88 11.88l1.07 1.07M3.05 12.95l1.06-1.06M11.88 4.12l1.07-1.07" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>
</aside>

<style>
  .sidebar {
    width: 220px;
    flex: 0 0 220px;
    background: var(--s1);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 8px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px 12px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .logo-mark {
    width: 30px; height: 30px;
    border-radius: 8px;
    background: var(--accent-bg);
    border: 1px solid var(--accent);
    color: var(--accent-t);
    font-size: 16px;
    font-weight: 800;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    box-shadow: 0 0 12px rgba(37,99,235,0.18);
  }

  .logo-name {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .new-chat {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: var(--r-md);
    background: var(--s2);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
    width: 100%;
  }
  .new-chat:hover {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-t);
  }

  .status-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: var(--text-3);
  }

  .status-row.warn { color: var(--caution); }

  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--border-strong);
  }
  .status-dot.green  { background: var(--safe); }
  .status-dot.red    { background: var(--danger); }
  .status-dot.amber  { background: var(--caution); }
  .status-dot.pulse  { animation: breathe 1.4s ease-in-out infinite; }

  .status-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .spacer { flex: 1; }

  .icon-btn {
    width: 36px; height: 36px;
    border-radius: var(--r-md);
    display: grid;
    place-items: center;
    color: var(--text-3);
    transition: background var(--t-fast), color var(--t-fast);
    align-self: flex-start;
  }
  .icon-btn:hover { background: var(--s2); color: var(--text-2); }
</style>
