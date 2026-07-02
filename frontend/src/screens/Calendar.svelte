<script>
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  let items = [], loading = true, title = "", when = "";

  async function load() { loading = true; items = (await api.calendar()).items || []; loading = false; }
  async function add() {
    if (!title.trim() || !when) return;
    await api.eventAdd({ title, starts_at: new Date(when).toISOString() });
    title = ""; when = ""; await load();
  }
  async function remove(id) { await api.eventDelete(id); await load(); }
  const fmt = (iso) => { try { return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };
  onMount(load);
</script>

<div class="page">
  <h1>Calendar</h1>
  <div class="composer">
    <input class="ttl" bind:value={title} placeholder="Event title" />
    <input class="dt" type="datetime-local" bind:value={when} />
    <button class="lemon" on:click={add}><i class="ti ti-plus"></i> Add</button>
  </div>
  {#if loading}<div class="empty">Loading…</div>
  {:else if items.length === 0}<div class="empty">No events yet. Add one, or say "put a meeting on Friday at 2pm" in chat.</div>
  {:else}
    <div class="list">
      {#each items as e}
        <div class="row">
          <div class="dot"></div>
          <div class="info"><div class="t">{e.title}</div><div class="w">{fmt(e.starts_at)}</div></div>
          <button class="del" on:click={() => remove(e.id)}><i class="ti ti-trash"></i></button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 760px; margin: 0 auto; padding: 28px 24px; }
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 20px; color: var(--text); }
  .composer { display: flex; gap: 10px; margin-bottom: 22px; flex-wrap: wrap; }
  .ttl { flex: 1; min-width: 180px; background: var(--s1); border: 1px solid var(--border); border-radius: 12px;
    padding: 12px 14px; font-size: 14px; color: var(--text); outline: none; }
  .dt { background: var(--s1); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; color: var(--text); }
  .lemon { background: var(--accent); color: var(--accent-t); border: none; padding: 0 16px; border-radius: 12px;
    font-weight: 700; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 12px; background: var(--s1); border: 1px solid var(--border);
    border-radius: 12px; padding: 14px 16px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
  .info { flex: 1; } .t { font-size: 15px; font-weight: 700; color: var(--text); }
  .w { font-size: 13px; color: var(--text-2); margin-top: 2px; }
  .del { background: none; border: none; color: var(--text-3); cursor: pointer; }
  .empty { text-align: center; color: var(--text-3); padding: 50px; }
</style>
