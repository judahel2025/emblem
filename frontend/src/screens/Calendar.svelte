<script>
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { connectedApps, appView } from "../lib/store.js";
  import GcalWorkspace from "./workspaces/GcalWorkspace.svelte";
  import ApprovalCard from "../components/ApprovalCard.svelte";

  // When Google Calendar is connected it becomes the ONE calendar — the page shows
  // and writes the user's real Google events (via the proven GcalWorkspace). The
  // local store is only used when Google isn't connected.
  $: gcalConnected = $connectedApps.includes("googlecalendar");

  // Shared approval surface for GcalWorkspace's write actions (create/delete event).
  let pendingApproval = null;
  function onApproval(info) {
    pendingApproval = {
      ...info,
      approve: async () => { const p = pendingApproval; pendingApproval = null; await p.__a(); },
      decline: async () => { const p = pendingApproval; pendingApproval = null; await p.__d(); },
      __a: info.approve, __d: info.decline,
    };
  }

  let items = [], loading = true, title = "", when = "";
  let selected = null;

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-11

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  async function load() { loading = true; items = (await api.calendar()).items || []; loading = false; }
  async function add() {
    if (!title.trim() || !when) return;
    await api.eventAdd({ title, starts_at: new Date(when).toISOString() });
    title = ""; when = ""; await load();
  }
  async function remove(id) { await api.eventDelete(id); selected = null; await load(); }

  function prevMonth() { if (viewMonth === 0) { viewMonth = 11; viewYear--; } else viewMonth--; }
  function nextMonth() { if (viewMonth === 11) { viewMonth = 0; viewYear++; } else viewMonth++; }
  function goToday() { const d = new Date(); viewYear = d.getFullYear(); viewMonth = d.getMonth(); }

  function openEvent(e) {
    selected = selected?.id === e.id ? null : e;
    if (selected) {
      try { const d = new Date(e.starts_at); viewYear = d.getFullYear(); viewMonth = d.getMonth(); } catch { /* keep view */ }
    }
  }

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Cells: leading blanks + days of month + trailing blanks to complete the last week.
  $: cells = (() => {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const lead = first.getDay();
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(viewYear, viewMonth, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  })();

  $: eventsByDay = (() => {
    const map = {};
    for (const e of items) {
      try {
        const k = dayKey(new Date(e.starts_at));
        (map[k] ||= []).push(e);
      } catch { /* skip unparseable */ }
    }
    for (const k in map) map[k].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    return map;
  })();

  $: upcoming = items
    .filter((e) => { try { return new Date(e.starts_at) >= new Date(new Date().setHours(0, 0, 0, 0)); } catch { return false; } })
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 5);

  $: monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  $: todayKey = dayKey(new Date());

  const fmtFull = (iso) => {
    try { return new Date(iso).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };
  const fmtTime = (iso) => {
    try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  };
  const fmtShort = (iso) => {
    try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  };

  onMount(load);
</script>

{#if gcalConnected}
  <!-- Google Calendar connected → it IS the calendar (real read/write). -->
  <div class="gcal-page">
    <header class="gcal-head reveal-in">
      <div>
        <h1>Calendar <span class="synced"><i class="ti ti-brand-google"></i> Synced with Google</span></h1>
        <p class="sub">Your real Google Calendar. Adding or removing events asks for approval first.</p>
      </div>
      <button class="btn ghost" on:click={() => appView.set("connect")}>Manage connection</button>
    </header>
    <div class="gcal-host"><GcalWorkspace {onApproval} /></div>
  </div>
  {#if pendingApproval}
    <div class="ap-veil">
      <div class="ap-holder" in:fly={{ y: 14, duration: 200 }}>
        <ApprovalCard approval={{ id: pendingApproval.approval_id, summary: pendingApproval.summary, args_json: pendingApproval.args_json }}
          variant="modal" onApprove={pendingApproval.approve} onDecline={pendingApproval.decline} />
      </div>
    </div>
  {/if}
{:else}
<div class="page" data-tour="calendar-root">
  <!-- Header: month as the display title, segmented pill nav on the right -->
  <header class="head reveal-in">
    <div>
      <h1>{monthLabel}</h1>
      <p class="sub">Your schedule, at a glance. Emblem can add events for you from chat.</p>
    </div>
    <div class="pillgroup" role="group" aria-label="Calendar navigation">
      <button class="pillbtn" on:click={prevMonth} aria-label="Previous month"><i class="ti ti-chevron-left"></i></button>
      <button class="pillbtn today" on:click={goToday}>Today</button>
      <button class="pillbtn" on:click={nextMonth} aria-label="Next month"><i class="ti ti-chevron-right"></i></button>
    </div>
  </header>

  <div class="layout">
    <!-- Main calendar: glass sheet, bordered day cells, left-accent event chips -->
    <div class="cal glass">
      <div class="wk" aria-hidden="true">
        {#each WEEKDAYS as w}<div class="wkday">{w}</div>{/each}
      </div>
      <div class="days">
        {#each cells as d}
          {#if d}
            {@const k = dayKey(d)}
            <div class="day" class:today={k === todayKey}>
              <span class="num">{d.getDate()}</span>
              {#if k === todayKey}<span class="dot" aria-hidden="true"></span>{/if}
              {#each (eventsByDay[k] || []).slice(0, 3) as e (e.id)}
                <button class="chip" class:active={selected?.id === e.id}
                  on:click={() => selected = selected?.id === e.id ? null : e}
                  aria-label={`Event: ${e.title} at ${fmtTime(e.starts_at)}`}
                  in:fade={{ duration: 150 }}>
                  {e.title}
                </button>
              {/each}
              {#if (eventsByDay[k] || []).length > 3}
                <span class="more">+{eventsByDay[k].length - 3} more</span>
              {/if}
            </div>
          {:else}
            <div class="day blank"></div>
          {/if}
        {/each}
      </div>
    </div>

    <!-- Side panels (mockup's right rail): detail, composer, upcoming -->
    <aside class="side">
      {#if selected}
        <div class="panel glass" transition:fly={{ y: 8, duration: 180 }}>
          <span class="accentbar" aria-hidden="true"></span>
          <div class="ptitle"><i class="ti ti-calendar-event"></i><h3>Event</h3></div>
          <div class="dtitle">{selected.title}</div>
          <div class="dwhen">{fmtFull(selected.starts_at)}</div>
          <div class="dactions">
            <button class="btn ghost" on:click={() => selected = null}>Close</button>
            <button class="btn danger" on:click={() => remove(selected.id)}><i class="ti ti-trash"></i> Delete</button>
          </div>
        </div>
      {/if}

      <div class="panel glass">
        <div class="ptitle"><i class="ti ti-plus"></i><h3>New event</h3></div>
        <label class="field">
          <span>Event title</span>
          <input bind:value={title} placeholder="e.g. Coffee with Sam" />
        </label>
        <label class="field">
          <span>When</span>
          <input type="datetime-local" bind:value={when} />
        </label>
        <button class="btn primary addbtn" on:click={add} disabled={!title.trim() || !when}>
          <i class="ti ti-plus"></i> Add event
        </button>
      </div>

      <div class="panel glass">
        <span class="accentbar" aria-hidden="true"></span>
        <div class="ptitle"><i class="ti ti-bolt"></i><h3>Coming up</h3></div>
        {#if loading}
          <div class="pnote">Loading…</div>
        {:else if upcoming.length === 0}
          <div class="pnote">No events yet. Add one here, or say "put a meeting on Friday at 2pm" in chat.</div>
        {:else}
          <div class="uplist">
            {#each upcoming as e (e.id)}
              <button class="uprow" class:active={selected?.id === e.id} on:click={() => openEvent(e)}
                aria-label={`Show event: ${e.title}`}>
                <span class="uptitle">{e.title}</span>
                <span class="upwhen">{fmtShort(e.starts_at)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </aside>
  </div>
</div>
{/if}

<style>
  .page { max-width: 1200px; margin: 0 auto; padding: 32px 24px 60px; }

  /* Google-connected calendar host */
  .gcal-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .gcal-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
    padding: 24px 24px 16px; flex-wrap: wrap; }
  .gcal-head h1 { font-size: 30px; font-weight: 600; letter-spacing: -0.03em; margin: 0 0 6px; color: var(--text);
    display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .synced { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: var(--r-pill); background: var(--accent-bg); color: var(--text-2);
    border: 1px solid var(--border); }
  .synced i { font-size: 14px; }
  .gcal-host { flex: 1; min-height: 0; display: flex; }
  .gcal-host :global(.gcal), .gcal-host > :global(*) { flex: 1; min-height: 0; width: 100%; }
  .ap-veil { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.45); display: grid; place-items: center; }
  .ap-holder { max-width: calc(100vw - 40px); }

  /* ── Header ── */
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  h1 { font-size: 32px; font-weight: 600; letter-spacing: -0.03em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; margin: 0; }

  .pillgroup {
    display: flex; align-items: center; gap: 4px;
    background: var(--s1); border: 1px solid var(--border);
    border-radius: 999px; padding: 4px;
  }
  .pillbtn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 7px 14px; border-radius: 999px;
    font-size: 13px; font-weight: 500; color: var(--text-2);
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .pillbtn:hover { background: var(--s3); color: var(--text); }
  .pillbtn.today { background: var(--bg-2); color: var(--accent-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
  .pillbtn i { font-size: 16px; }

  /* ── Layout: calendar sheet + side rail ── */
  .layout { display: flex; gap: 24px; align-items: flex-start; }
  .cal { flex: 1; min-width: 0; border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
  .side { flex: 0 0 300px; width: 300px; display: flex; flex-direction: column; gap: 16px; }

  /* ── Weekday header row ── */
  .wk {
    display: grid; grid-template-columns: repeat(7, 1fr);
    border-bottom: 1px solid var(--border);
    background: var(--s1);
  }
  .wkday {
    font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--text-3); text-align: center; padding: 12px 0;
  }

  /* ── Month grid: bordered cells, no gaps ── */
  .days { display: grid; grid-template-columns: repeat(7, 1fr); }
  .day {
    position: relative;
    min-height: 108px; padding: 8px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 4px;
    overflow: hidden;
    transition: background var(--t-fast);
  }
  .day:nth-child(7n) { border-right: none; }
  .days .day:nth-last-child(-n+7) { border-bottom: none; }
  .day:not(.blank):not(.today):hover { background: var(--s1); }
  .day.blank { background: var(--s1); opacity: 0.5; }
  .day.today { background: var(--accent-bg); }
  .day.today .num { color: var(--accent-ink); font-weight: 700; }
  .dot { position: absolute; top: 10px; right: 10px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .num { font-size: 12px; font-weight: 500; color: var(--text-2); line-height: 1; padding: 2px 0; }

  /* Event chips: left accent bar (mockup anatomy) */
  .chip {
    display: block; width: 100%;
    font-size: 11px; font-weight: 600; text-align: left;
    padding: 4px 7px;
    border-radius: var(--r-sm);
    background: var(--accent-bg); color: var(--accent-ink);
    border: none; border-left: 2px solid var(--accent);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: pointer;
    transition: box-shadow var(--t-fast), filter var(--t-fast);
  }
  .chip:hover { filter: brightness(0.96); }
  .chip.active { box-shadow: 0 0 0 1px var(--accent); }
  .more { font-size: 10px; color: var(--text-3); padding: 0 2px; }

  /* ── Side panels ── */
  .panel {
    position: relative; overflow: hidden;
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 18px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .accentbar { position: absolute; left: 0; top: 0; width: 3px; height: 100%; background: var(--accent); opacity: 0.5; }
  .ptitle { display: flex; align-items: center; gap: 8px; }
  .ptitle i { font-size: 17px; color: var(--accent-ink); }
  .ptitle h3 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: var(--text); }
  .pnote { font-size: 13px; color: var(--text-2); line-height: 1.55; }

  /* Event detail */
  .dtitle { font-size: 15px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
  .dwhen { font-size: 13px; color: var(--text-2); margin-top: -6px; }
  .dactions { display: flex; gap: 8px; }
  .dactions .btn { flex: 1; font-size: 13px; padding: 8px 12px; cursor: pointer; }

  /* Composer */
  .addbtn { width: 100%; cursor: pointer; }

  /* Upcoming list rows */
  .uplist { display: flex; flex-direction: column; gap: 8px; }
  .uprow {
    display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
    width: 100%; text-align: left;
    padding: 10px 12px;
    background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-md);
    cursor: pointer;
    transition: border-color var(--t-fast), background var(--t-fast);
  }
  .uprow:hover { border-color: var(--accent-glow); }
  .uprow.active { border-color: var(--accent); background: var(--accent-bg); }
  .uptitle {
    font-size: 13px; font-weight: 600; color: var(--text);
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .upwhen { font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-3); }

  @media (max-width: 920px) {
    .layout { flex-direction: column; }
    .side { width: 100%; flex: 1 1 auto; }
    .day { min-height: 84px; }
    h1 { font-size: 26px; }
  }
</style>
