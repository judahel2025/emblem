<script>
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  let items = [], loading = true, instruction = "", every = "day", title = "";
  const EVERY = ["minute", "hour", "day", "week"];

  async function load() { loading = true; items = (await api.automations()).items || []; loading = false; }
  async function add() {
    if (!instruction.trim()) return;
    await api.automationAdd(title || instruction.slice(0, 40), instruction, every);
    instruction = ""; title = ""; await load();
  }
  async function toggle(a) { await api.automationToggle(a.id, !a.enabled); await load(); }
  async function remove(id) { await api.automationDelete(id); await load(); }
  onMount(load);
</script>

<div class="page">
  <h1>Automations</h1>
  <p class="sub">Set something once and Emblem runs it on its own — quietly, on schedule.</p>

  <div class="composer">
    <input class="instr" bind:value={instruction} placeholder="e.g. Every morning, summarize my unread email and message me the highlights" />
    <select bind:value={every}>{#each EVERY as e}<option value={e}>every {e}</option>{/each}</select>
    <button class="lemon" on:click={add}><i class="ti ti-plus"></i> Add</button>
  </div>

  {#if loading}<div class="empty">Loading…</div>
  {:else if items.length === 0}<div class="empty">No automations yet.</div>
  {:else}
    <div class="list">
      {#each items as a}
        <div class="row">
          <div class="info">
            <div class="t">{a.title}</div>
            <div class="d">{a.instruction}</div>
          </div>
          <button class="tg" class:on={a.enabled} on:click={() => toggle(a)}>{a.enabled ? "On" : "Off"}</button>
          <button class="del" on:click={() => remove(a.id)}><i class="ti ti-trash"></i></button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 820px; margin: 0 auto; padding: 28px 24px; }
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 14px; margin: 0 0 22px; }
  .composer { display: flex; gap: 10px; margin-bottom: 22px; }
  .instr { flex: 1; background: var(--s1); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px;
    font-size: 14px; color: var(--text); outline: none; }
  select { background: var(--s1); border: 1px solid var(--border); border-radius: 12px; padding: 0 12px; color: var(--text); }
  .lemon { background: var(--accent); color: var(--accent-t); border: none; padding: 0 16px; border-radius: 12px;
    font-weight: 700; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 12px; background: var(--s1); border: 1px solid var(--border);
    border-radius: 12px; padding: 14px 16px; }
  .info { flex: 1; }
  .t { font-size: 15px; font-weight: 700; color: var(--text); }
  .d { font-size: 13px; color: var(--text-2); margin-top: 2px; }
  .tg { border: 1px solid var(--border-strong); background: var(--s2); color: var(--text-3); border-radius: 20px;
    padding: 5px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .tg.on { background: var(--accent-bg); color: var(--accent-t); border-color: var(--border-strong); }
  .del { background: none; border: none; color: var(--text-3); cursor: pointer; }
  .empty { text-align: center; color: var(--text-3); padding: 50px; }
</style>
