<script>
  // Calendar workspace — the connected account's real month view.
  // Mirrors the native Calendar screen's grid; reads run free through
  // runConnected, create/delete pause for approval (card rendered by parent).
  import { fly, fade } from "svelte/transition";
  import { runConnected } from "../../lib/workspaces.js";

  export let onApproval;

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-11

  let events = [];
  let loading = true;
  let error = "";
  let selected = null;
  let debugged = false;

  // Quick add
  let title = "";
  let when = "";
  let duration = "60";
  let adding = false;
  let addError = "";
  let addNotice = "";

  // Delete
  let deleting = false;
  let deleteError = "";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ── Defensive shape helpers (connected-app responses vary) ────
  const evId = (e) => e?.id ?? e?.eventId ?? e?.event_id ?? "";
  const evTitle = (e) => e?.summary ?? e?.title ?? "(untitled)";
  const isAllDay = (e) => Boolean(e?.start?.date && !e?.start?.dateTime);
  function parseDatePart(v) {
    // "YYYY-MM-DD" as a LOCAL date (avoids UTC off-by-one).
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function evStart(e) {
    const s = e?.start;
    if (s?.dateTime) { const d = new Date(s.dateTime); return isNaN(d.getTime()) ? null : d; }
    if (s?.date) return parseDatePart(s.date);
    if (typeof s === "string") return parseDatePart(s);
    return null;
  }
  function evEnd(e) {
    const s = e?.end;
    if (s?.dateTime) { const d = new Date(s.dateTime); return isNaN(d.getTime()) ? null : d; }
    if (s?.date) return parseDatePart(s.date);
    if (typeof s === "string") return parseDatePart(s);
    return null;
  }

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // ── Load a month of events ────────────────────────────────────
  let reqToken = 0;
  async function loadMonth(y, m) {
    const token = ++reqToken;
    loading = true;
    error = "";
    selected = null;
    try {
      const timeMin = new Date(y, m, 1).toISOString();
      const timeMax = new Date(y, m + 1, 1).toISOString();
      const res = await runConnected("GOOGLECALENDAR_EVENTS_LIST", {
        calendar_id: "primary",
        time_min: timeMin,
        time_max: timeMax,
        single_events: true,
        order_by: "startTime",
        max_results: 250,
      });
      if (token !== reqToken) return;
      if (!debugged) { console.debug("[calendar] events response:", res); debugged = true; }
      const list = res?.items ?? res?.data?.items ?? res?.events ?? res?.data?.events ?? res;
      events = Array.isArray(list) ? list : [];
    } catch (e) {
      if (token !== reqToken) return;
      error = e?.message || "Couldn't load your calendar.";
      events = [];
    }
    if (token === reqToken) loading = false;
  }

  // Reactive: fires on mount and whenever the visible month changes.
  $: loadMonth(viewYear, viewMonth);

  function prevMonth() { if (viewMonth === 0) { viewMonth = 11; viewYear--; } else viewMonth--; }
  function nextMonth() { if (viewMonth === 11) { viewMonth = 0; viewYear++; } else viewMonth++; }
  function goToday() { const d = new Date(); viewYear = d.getFullYear(); viewMonth = d.getMonth(); }

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
    for (const e of events) {
      const d = evStart(e);
      if (!d) continue;
      (map[dayKey(d)] ||= []).push(e);
    }
    for (const k in map) {
      map[k].sort((a, b) => {
        if (isAllDay(a) !== isAllDay(b)) return isAllDay(a) ? -1 : 1;
        return (evStart(a)?.getTime() || 0) - (evStart(b)?.getTime() || 0);
      });
    }
    return map;
  })();

  $: monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  $: todayKey = dayKey(new Date());

  const fmtTime = (d) => {
    try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  };
  function timeRange(e) {
    if (isAllDay(e)) return "All day";
    const s = evStart(e), en = evEnd(e);
    if (!s) return "";
    const day = s.toLocaleDateString([], { weekday: "short", month: "long", day: "numeric" });
    if (!en) return `${day}, ${fmtTime(s)}`;
    const sameDay = dayKey(s) === dayKey(en);
    return sameDay
      ? `${day}, ${fmtTime(s)} – ${fmtTime(en)}`
      : `${day}, ${fmtTime(s)} – ${en.toLocaleDateString([], { month: "short", day: "numeric" })}, ${fmtTime(en)}`;
  }
  const chipLabel = (e) => (isAllDay(e) ? evTitle(e) : `${fmtTime(evStart(e))} ${evTitle(e)}`);

  function pickEvent(e) {
    selected = selected && evId(selected) === evId(e) ? null : e;
    deleteError = "";
  }

  // ── Delete (approval-gated) ───────────────────────────────────
  async function removeEvent() {
    if (!selected) return;
    deleting = true;
    deleteError = "";
    try {
      await runConnected(
        "GOOGLECALENDAR_DELETE_EVENT",
        { calendar_id: "primary", event_id: evId(selected) },
        { act: true, onApproval },
      );
      selected = null;
      await loadMonth(viewYear, viewMonth);
    } catch (e) {
      deleteError = e?.message || "Couldn't delete the event.";
    }
    deleting = false;
  }

  // ── Quick add (approval-gated, defensive param shapes) ────────
  async function addEvent() {
    if (!title.trim() || !when) return;
    adding = true;
    addError = "";
    addNotice = "";
    const start = new Date(when);
    if (isNaN(start.getTime())) { addError = "That start time doesn't look right."; adding = false; return; }
    const mins = Number(duration) || 60;
    const end = new Date(start.getTime() + mins * 60000);
    const summary = title.trim();
    try {
      try {
        await runConnected(
          "GOOGLECALENDAR_CREATE_EVENT",
          {
            calendar_id: "primary",
            summary,
            start_datetime: start.toISOString(),
            event_duration_hour: Math.floor(mins / 60),
            event_duration_minutes: mins % 60,
          },
          { act: true, onApproval },
        );
      } catch (err) {
        // User said no — don't ask again with a different shape.
        if (String(err?.message || "") === "Declined.") throw err;
        console.debug("[calendar] create with flat params failed, retrying start/end shape:", err);
        await runConnected(
          "GOOGLECALENDAR_CREATE_EVENT",
          {
            calendar_id: "primary",
            summary,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
          },
          { act: true, onApproval },
        );
      }
      addNotice = "Event added.";
      title = "";
      when = "";
      await loadMonth(viewYear, viewMonth);
    } catch (e) {
      addError = e?.message || "Couldn't add the event.";
    }
    adding = false;
  }
</script>

<div class="gcal">
  <div class="inner">
    <header class="head">
      <div class="month" aria-live="polite">{monthLabel}</div>
      <div class="nav">
        <button class="btn ghost navbtn" on:click={prevMonth} aria-label="Previous month"><i class="ti ti-chevron-left"></i></button>
        <button class="btn" on:click={goToday} aria-label="Jump to today">Today</button>
        <button class="btn ghost navbtn" on:click={nextMonth} aria-label="Next month"><i class="ti ti-chevron-right"></i></button>
        <button class="btn ghost navbtn" on:click={() => loadMonth(viewYear, viewMonth)} disabled={loading} aria-label="Refresh events" title="Refresh">
          {#if loading}<span class="spin"></span>{:else}<i class="ti ti-refresh"></i>{/if}
        </button>
      </div>
    </header>

    {#if error}
      <div class="state error">
        <p>{error}</p>
        <button class="btn" on:click={() => loadMonth(viewYear, viewMonth)}>Try again</button>
      </div>
    {:else}
      <div class="cal card-surface">
        <div class="grid wk" aria-hidden="true">
          {#each WEEKDAYS as w}<div class="wkday">{w}</div>{/each}
        </div>
        <div class="grid days">
          {#each cells as d}
            {#if d}
              {@const k = dayKey(d)}
              <div class="day" class:today={k === todayKey}>
                <span class="num">{d.getDate()}</span>
                {#each (eventsByDay[k] || []).slice(0, 3) as e (evId(e) || chipLabel(e))}
                  <button
                    class="chip"
                    class:active={selected && evId(selected) === evId(e)}
                    on:click={() => pickEvent(e)}
                    aria-label={`Event: ${evTitle(e)}, ${timeRange(e)}`}
                    in:fade={{ duration: 150 }}
                  >
                    {chipLabel(e)}
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

      {#if loading}
        <div class="state"><span class="spin"></span> Loading your events…</div>
      {:else if events.length === 0}
        <div class="empty">No events this month. Add one below.</div>
      {/if}

      {#if selected}
        <div class="detail" transition:fly={{ y: 8, duration: 180 }}>
          <div class="dinfo">
            <div class="dtitle">{evTitle(selected)}</div>
            <div class="dwhen">{timeRange(selected)}</div>
            {#if selected.location}
              <div class="dmeta"><i class="ti ti-map-pin"></i> {selected.location}</div>
            {/if}
            {#if Array.isArray(selected.attendees) && selected.attendees.length}
              <div class="dmeta"><i class="ti ti-users"></i> {selected.attendees.length} attendee{selected.attendees.length === 1 ? "" : "s"}</div>
            {/if}
            {#if deleteError}<div class="derr">{deleteError}</div>{/if}
          </div>
          <button class="btn ghost" on:click={() => (selected = null)} aria-label="Close event details">Close</button>
          <button class="btn danger" on:click={removeEvent} disabled={deleting} aria-label={`Delete event ${evTitle(selected)}`}>
            {#if deleting}<span class="spin"></span>{:else}<i class="ti ti-trash"></i>{/if} Delete
          </button>
        </div>
      {/if}

      <div class="composer">
        <label class="field grow">
          <span>Event title</span>
          <input bind:value={title} placeholder="e.g. Coffee with Sam" aria-label="New event title" />
        </label>
        <label class="field">
          <span>Starts</span>
          <input type="datetime-local" bind:value={when} aria-label="New event start time" />
        </label>
        <label class="field">
          <span>Length</span>
          <select bind:value={duration} aria-label="New event duration">
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
          </select>
        </label>
        <button class="btn primary addbtn" on:click={addEvent} disabled={adding || !title.trim() || !when} aria-label="Add event">
          {#if adding}<span class="spin"></span>{:else}<i class="ti ti-plus"></i>{/if} Add
        </button>
      </div>
      {#if addNotice}<p class="notice safe" in:fly={{ y: 6, duration: 150 }}><i class="ti ti-check"></i> {addNotice}</p>{/if}
      {#if addError}<p class="notice danger" in:fly={{ y: 6, duration: 150 }}>{addError}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .gcal { flex: 1; min-height: 0; overflow-y: auto; }
  .inner { max-width: 960px; margin: 0 auto; padding: 20px 24px 60px; }

  .head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
  .month { font-size: 17px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .nav { display: flex; gap: 8px; align-items: center; }
  .navbtn { padding: 9px 12px; cursor: pointer; }

  /* ── Month card (mirrors the native Calendar screen) ── */
  .card-surface {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 18px;
  }
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
    flex-wrap: wrap;
  }
  .dinfo { flex: 1; min-width: 200px; }
  .dtitle { font-size: 15px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dwhen { font-size: 13px; color: var(--text-2); margin-top: 2px; }
  .dmeta { font-size: 12.5px; color: var(--text-3); margin-top: 2px; display: flex; align-items: center; gap: 5px; }
  .derr { font-size: 12.5px; color: var(--danger); margin-top: 4px; }

  /* ── Quick add row ── */
  .composer { display: flex; gap: 12px; align-items: flex-end; margin-top: 18px; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 200px; }
  .addbtn { flex: 0 0 auto; }

  .notice { margin: 10px 0 0; font-size: 13px; display: flex; align-items: center; gap: 6px; }
  .notice.safe { color: var(--safe); }
  .notice.danger { color: var(--danger); }

  .state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; padding: 32px 20px; color: var(--text-3); font-size: 13.5px;
  }
  .state.error p { margin: 0; color: var(--danger); }
</style>
