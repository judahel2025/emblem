<script>
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { notifications, loadNotifications, markNotifRead, markAllNotifsRead,
           deleteNotif, askNotifPermission } from "../lib/store.js";
  import { brandLogo, logoUrl, MONO_LOGOS } from "../lib/logos.js";

  const KIND_ICON = { mail: "ti-mail", event: "ti-calendar", activity: "ti-activity",
                      automation: "ti-bolt", reminder: "ti-bell", info: "ti-info-circle" };
  const isConnector = (app) => app && app !== "system";

  function ago(iso) {
    const t = Date.parse((iso || "").replace(" ", "T") + "Z");
    if (isNaN(t)) return "";
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function imgFallback(e) { e.currentTarget.style.display = "none"; const i = e.currentTarget.nextElementSibling; if (i) i.style.display = ""; }

  let permAsked = false;
  onMount(() => { loadNotifications(); });
  function enablePush() { askNotifPermission(); permAsked = true; }

  $: items = $notifications.items || [];
  $: unread = $notifications.unread || 0;
  $: canAskPush = typeof Notification !== "undefined" && Notification.permission === "default";
</script>

<div class="page">
  <header class="head reveal-in">
    <div>
      <h1>Notifications {#if unread}<span class="hcount">{unread}</span>{/if}</h1>
      <p class="sub">Activity from your connected apps — new mail, calendar, and updates — all in one place.</p>
    </div>
    <div class="headacts">
      {#if canAskPush && !permAsked}
        <button class="btn ghost" on:click={enablePush}><i class="ti ti-bell"></i> Enable pop-ups</button>
      {/if}
      {#if unread}
        <button class="btn ghost" on:click={markAllNotifsRead}><i class="ti ti-checks"></i> Mark all read</button>
      {/if}
    </div>
  </header>

  {#if items.length === 0}
    <div class="empty blank" in:fly={{ y: 8, duration: 200 }}>
      <i class="ti ti-bell-off"></i>
      <p>You're all caught up. New activity from your connected apps shows up here.</p>
    </div>
  {:else}
    <ul class="nlist stagger">
      {#each items as n (n.id)}
        <li class="nrow" class:unread={!n.read} in:fly={{ y: 6, duration: 160 }}>
          <span class="nic" class:mono={MONO_LOGOS.has(n.app)}>
            {#if isConnector(n.app) && brandLogo(n.app)}{@html brandLogo(n.app)}
            {:else if isConnector(n.app)}
              <img class="nimg" src={logoUrl(n.app)} alt={n.app} on:error={imgFallback} /><i class="ti {KIND_ICON[n.kind] || 'ti-bell'}" style="display:none"></i>
            {:else}<i class="ti {KIND_ICON[n.kind] || 'ti-bell'}"></i>{/if}
          </span>
          <button class="nbody" on:click={() => markNotifRead(n.id)}>
            <span class="ntitle">{n.title}</span>
            {#if n.body}<span class="ndesc">{n.body}</span>{/if}
            <span class="nmeta">{ago(n.created_at)}</span>
          </button>
          {#if !n.read}<span class="ndot" aria-label="Unread"></span>{/if}
          <button class="ndel" on:click={() => deleteNotif(n.id)} aria-label="Dismiss"><i class="ti ti-x"></i></button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page { max-width: 780px; margin: 0 auto; padding: 32px 24px 60px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
  h1 { font-size: 32px; font-weight: 500; letter-spacing: -0.03em; margin: 0 0 6px; color: var(--text); display: inline-flex; align-items: center; gap: 12px; }
  .hcount { font-size: 14px; font-weight: 500; min-width: 26px; height: 26px; padding: 0 8px; border-radius: var(--r-pill);
    background: var(--accent); color: #fff; display: inline-grid; place-items: center; }
  .sub { color: var(--text-2); font-size: 13px; margin: 0; max-width: 520px; }
  .headacts { display: flex; gap: 10px; }

  .empty.blank { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 70px 20px; text-align: center; color: var(--text-3); }
  .empty.blank i { font-size: 34px; }
  .empty.blank p { max-width: 340px; margin: 0; font-size: 14px; line-height: 1.55; }

  .nlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .nrow {
    display: flex; align-items: center; gap: 14px;
    padding: 13px 14px; border-radius: var(--r-md);
    background: var(--surface); -webkit-backdrop-filter: var(--glass-blur) var(--glass-sat); backdrop-filter: var(--glass-blur) var(--glass-sat);
    border: 1px solid var(--border); box-shadow: var(--glass-hi);
  }
  .nrow.unread { border-color: var(--border-strong); }
  .nic {
    width: 40px; height: 40px; border-radius: var(--r-md); flex-shrink: 0;
    display: grid; place-items: center; font-size: 19px;
    background: var(--s2); color: var(--text);
  }
  .nic :global(svg) { width: 24px; height: 24px; }
  .nic .nimg { width: 24px; height: 24px; object-fit: contain; }
  .nic.mono :global(svg) { color: var(--text); }
  .nbody { flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
  .ntitle { font-size: 14px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ndesc { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nmeta { font-size: 11px; color: var(--text-3); margin-top: 2px; }
  .ndot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  .ndel { width: 30px; height: 30px; border-radius: var(--r-sm); display: grid; place-items: center; color: var(--text-3); flex-shrink: 0;
    transition: color var(--t-fast), background var(--t-fast); }
  .ndel:hover { color: var(--text); background: var(--s3); }
</style>
