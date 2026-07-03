<script>
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { api } from "../lib/api.js";
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

  onMount(load);
</script>

<div class="page">
  <header class="head">
    <div>
      <h1>Calendar</h1>
      <p class="sub">Your schedule, at a glance. Emblem can add events for you from chat.</p>
    </div>
    <div class="nav">
      <button class="btn ghost navbtn" on:click={prevMonth} aria-label="Previous month"><i class="ti ti-chevron-left"></i></button>
      <button class="btn" on:click={goToday}>Today</button>
      <button class="btn ghost navbtn" on:click={nextMonth} aria-label="Next month"><i class="ti ti-chevron-right"></i></button>
    </div>
  </header>

  <div class="cal card-surface">
    <div class="month">{monthLabel}</div>
    <div class="grid wk" aria-hidden="true">
      {#each WEEKDAYS as w}<div class="wkday">{w}</div>{/each}
    </div>
    <div class="grid days">
      {#each cells as d}
        {#if d}
          {@const k = dayKey(d)}
          <div class="day" class:today={k === todayKey}>
            <span class="num">{d.getDate()}</span>
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

  {#if selected}
    <div class="detail" transition:fly={{ y: 8, duration: 180 }}>
      <div class="dinfo">
        <div class="dtitle">{selected.title}</div>
        <div class="dwhen">{fmtFull(selected.starts_at)}</div>
      </div>
      <button class="btn ghost" on:click={() => selected = null}>Close</button>
      <button class="btn danger" on:click={() => remove(selected.id)}><i class="ti ti-trash"></i> Delete</button>
    </div>
  {/if}

  <div class="composer">
    <label class="field grow">
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

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if items.length === 0}
    <div class="empty">No events yet. Add one above, or say "put a meeting on Friday at 2pm" in chat.</div>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: 28px 24px 60px; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; margin: 0; }
  .nav { display: flex; gap: 8px; align-items: center; }
  .navbtn { padding: 9px 12px; cursor: pointer; }

  /* ── Month card ── */
  .card-surface {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 18px;
  }
  .month { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 12px; letter-spacing: -0.01em; }

  .grid { display: grid; grid-template-columns: repeat(7, 1fr); }
  .wk { margin-bottom: 6px; }
  .wkday {
    font-size: 11px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--text-3); text-align: center; padding: 4px 0;
  }
  .days { gap: 4px; }
  .day {
    min-height: 84px; padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg);
    display: flex; flex-direction: column; gap: 3px;
    overflow: hidden;
  }
  .day.blank { border-color: transparent; background: transparent; }
  .day.today { box-shadow: 0 0 0 2px var(--accent); border-color: transparent; }
  .day.today .num { color: var(--accent-ink); font-weight: 600; }
  .num { font-size: 12px; color: var(--text-2); line-height: 1; padding: 2px; }

  .chip {
    display: block; width: 100%;
    font-size: 11px; font-weight: 500; text-align: left;
    padding: 3px 7px; border-radius: 6px;
    background: var(--accent-bg); color: var(--accent-ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: pointer; border: 1px solid transparent;
    transition: border-color var(--t-fast), filter var(--t-fast);
  }
  .chip:hover { border-color: var(--accent); }
  .chip.active { border-color: var(--accent); }
  .more { font-size: 10px; color: var(--text-3); padding: 0 2px; }

  /* ── Event detail ── */
  .detail {
    display: flex; align-items: center; gap: 10px;
    margin-top: 14px; padding: 14px 18px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-md);
  }
  .dinfo { flex: 1; min-width: 0; }
  .dtitle { font-size: 15px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dwhen { font-size: 13px; color: var(--text-2); margin-top: 2px; }

  /* ── Add event row ── */
  .composer { display: flex; gap: 12px; align-items: flex-end; margin-top: 18px; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 200px; }
  .addbtn { flex: 0 0 auto; }
</style>
