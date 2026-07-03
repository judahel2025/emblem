<script>
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
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

<div class="page" data-tour="automations-root">
  <header class="head">
    <div>
      <h1>Automations</h1>
      <p class="sub">Set something once and Emblem runs it on its own — quietly, on schedule.</p>
    </div>
  </header>

  <div class="composer">
    <label class="field grow">
      <span>What should Emblem do?</span>
      <textarea rows="2" bind:value={instruction}
        placeholder="e.g. Every morning, summarize my unread email and message me the highlights"></textarea>
    </label>
    <div class="controls">
      <label class="field">
        <span>Frequency</span>
        <select bind:value={every}>
          {#each EVERY as e}<option value={e}>every {e}</option>{/each}
        </select>
      </label>
      <button class="btn primary" on:click={add} disabled={!instruction.trim()}>
        <i class="ti ti-plus"></i> Create
      </button>
    </div>
  </div>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if items.length === 0}
    <div class="empty blank" in:fade={{ duration: 200 }}>
      <i class="ti ti-bolt"></i>
      <p>Automations run in the background — describe what you want in plain language.</p>
    </div>
  {:else}
    <div class="list">
      {#each items as a, i (a.id)}
        <div class="acard" in:fly={{ y: 8, duration: 200, delay: Math.min(i * 25, 200) }}>
          <div class="info">
            <div class="trow">
              <span class="atitle">{a.instruction || a.title}</span>
              <span class="badge accent">every {a.every || "day"}</span>
            </div>
            <div class="runs">Runs every {a.every || "day"}{a.enabled ? "" : " — paused"}</div>
          </div>
          <button class="toggle" class:on={a.enabled} on:click={() => toggle(a)}
            role="switch" aria-checked={a.enabled}
            aria-label={`${a.enabled ? "Disable" : "Enable"} automation: ${a.title}`}>
            <span class="knob"></span>
          </button>
          <button class="del" on:click={() => remove(a.id)} aria-label={`Delete automation: ${a.title}`}>
            <i class="ti ti-trash"></i>
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 820px; margin: 0 auto; padding: 28px 24px 60px; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; margin: 0; }

  /* ── Create row ── */
  .composer {
    display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 16px 18px;
    margin-bottom: 22px;
  }
  .grow { flex: 1; min-width: 240px; }
  .grow textarea { resize: vertical; min-height: 52px; }
  .controls { display: flex; gap: 10px; align-items: flex-end; }
  .controls select { cursor: pointer; }

  /* ── Cards list ── */
  .list { display: flex; flex-direction: column; gap: 10px; }
  .acard {
    display: flex; align-items: center; gap: 14px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 16px 18px;
    transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .acard:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }
  .info { flex: 1; min-width: 0; }
  .trow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .atitle { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .runs { font-size: 13px; color: var(--text-2); margin-top: 4px; }

  .toggle { flex: 0 0 auto; }
  .del {
    width: 32px; height: 32px; border-radius: var(--r-sm);
    display: grid; place-items: center;
    color: var(--text-3); cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast);
  }
  .del:hover { color: var(--danger); background: var(--danger-bg); }

  /* ── Empty state ── */
  .empty.blank { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 72px 24px; }
  .empty.blank i { font-size: 40px; color: var(--text-3); }
  .empty.blank p { margin: 0; font-size: 14px; color: var(--text-2); max-width: 400px; }
</style>
