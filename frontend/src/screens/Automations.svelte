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

  $: activeCount = items.filter((a) => a.enabled).length;

  onMount(load);
</script>

<div class="page" data-tour="automations-root">
  <!-- Page header: display title left, live-status glass chip right -->
  <header class="head reveal-in">
    <div>
      <h1>Automations</h1>
      <p class="sub">Set something once and Emblem runs it on its own — quietly, on schedule.</p>
    </div>
    {#if !loading && items.length}
      <div class="livechip glass" in:fade={{ duration: 150 }}>
        <span class="pulse" aria-hidden="true"></span>
        <span>{activeCount} active</span>
      </div>
    {/if}
  </header>

  <!-- Bento split: node list left, composer + featurette right -->
  <div class="cols">
    <section class="main">
      <div class="secthead">
        <h2>Scheduled actions</h2>
      </div>

      {#if loading}
        <div class="empty">Loading…</div>
      {:else if items.length === 0}
        <div class="blankstate glass" in:fade={{ duration: 200 }}>
          <i class="ti ti-bolt"></i>
          <p>Automations run in the background — describe what you want in plain language.</p>
        </div>
      {:else}
        <div class="nodes">
          <span class="rail" aria-hidden="true"></span>
          {#each items as a, i (a.id)}
            <div class="acard glass" class:paused={!a.enabled} in:fly={{ y: 8, duration: 200, delay: Math.min(i * 25, 200) }}>
              <div class="arow">
                <span class="nodeicon"><i class="ti ti-bolt"></i></span>
                <div class="info">
                  <div class="trow">
                    <span class="atitle">{a.instruction || a.title}</span>
                    <span class="state" class:on={a.enabled}>{a.enabled ? "Running" : "Paused"}</span>
                  </div>
                  <div class="runs">Runs every {a.every || "day"}</div>
                </div>
                <div class="actions">
                  <button class="iconbtn" role="switch" aria-checked={a.enabled} on:click={() => toggle(a)}
                    aria-label={`${a.enabled ? "Pause" : "Resume"} automation: ${a.title}`}>
                    <i class="ti {a.enabled ? 'ti-player-pause' : 'ti-player-play'}"></i>
                  </button>
                  <button class="iconbtn del" on:click={() => remove(a.id)} aria-label={`Delete automation: ${a.title}`}>
                    <i class="ti ti-trash"></i>
                  </button>
                </div>
              </div>
              <div class="afoot">
                <span class="meta"><i class="ti ti-clock"></i> every {a.every || "day"}</span>
                {#if !a.enabled}
                  <span class="meta warn"><i class="ti ti-player-pause"></i> Paused — resume anytime</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <aside class="side">
      <!-- Composer as a side panel -->
      <div class="panel glass">
        <div class="ptitle"><i class="ti ti-plus"></i><h2>New automation</h2></div>
        <label class="field">
          <span>What should Emblem do?</span>
          <textarea rows="3" bind:value={instruction}
            placeholder="e.g. Every morning, summarize my unread email and message me the highlights"></textarea>
        </label>
        <label class="field">
          <span>Frequency</span>
          <select bind:value={every}>
            {#each EVERY as e}<option value={e}>every {e}</option>{/each}
          </select>
        </label>
        <button class="btn primary createbtn" on:click={add} disabled={!instruction.trim()}>
          <i class="ti ti-plus"></i> Create
        </button>
      </div>

      <!-- Featured accent card (mockup "Automate with AI") -->
      <div class="feature">
        <i class="ti ti-bolt watermark" aria-hidden="true"></i>
        <h3>Automate from chat</h3>
        <p>Describe a routine in plain language — "every Friday, draft my weekly recap" — and Emblem sets it up and runs it quietly.</p>
      </div>
    </aside>
  </div>
</div>

<style>
  .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 60px; }

  /* ── Header ── */
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  h1 { font-size: 32px; font-weight: 600; letter-spacing: -0.03em; margin: 0 0 6px; color: var(--text); }
  .sub { color: var(--text-2); font-size: 13px; margin: 0; max-width: 480px; }

  .livechip {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 14px; border-radius: 999px;
    font-size: 13px; font-weight: 500; color: var(--text-2);
    box-shadow: var(--shadow-sm);
  }
  .pulse {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--safe); flex: 0 0 auto;
    animation: pulsedot 2s ease-in-out infinite;
  }
  @keyframes pulsedot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* ── Bento columns ── */
  .cols { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start; }
  .secthead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .secthead h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: var(--text); }

  /* ── Node list with vertical connector rail ── */
  .nodes { position: relative; display: flex; flex-direction: column; gap: 16px; }
  .rail {
    position: absolute; top: 12px; bottom: 12px; left: 28px; width: 2px;
    background: linear-gradient(to bottom, var(--accent), transparent);
    opacity: 0.25;
  }
  .acard {
    position: relative;
    border-radius: var(--r-lg);
    border-left: 3px solid var(--accent);
    box-shadow: var(--shadow-sm);
    padding: 18px;
    transition: border-color var(--t-fast), box-shadow var(--t-fast);
  }
  .acard:hover { box-shadow: var(--shadow-md); }
  .acard.paused { border-left-color: var(--border-strong); }

  .arow { display: flex; align-items: flex-start; gap: 14px; }
  .nodeicon {
    width: 44px; height: 44px; border-radius: var(--r-md); flex: 0 0 auto;
    display: grid; place-items: center;
    background: var(--accent-bg); color: var(--accent-ink);
  }
  .nodeicon i { font-size: 22px; }
  .acard.paused .nodeicon { background: var(--s2); color: var(--text-3); }

  .info { flex: 1; min-width: 0; }
  .trow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .atitle { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .state {
    font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    padding: 3px 8px; border-radius: var(--r-sm);
    background: var(--s2); color: var(--text-2);
  }
  .state.on { background: var(--accent-bg); color: var(--accent-ink); }
  .runs { font-size: 13px; color: var(--text-2); margin-top: 4px; }

  .actions { display: flex; gap: 4px; flex: 0 0 auto; }
  .iconbtn {
    width: 34px; height: 34px; border-radius: var(--r-sm);
    display: grid; place-items: center;
    color: var(--text-3); cursor: pointer;
    transition: color var(--t-fast), background var(--t-fast);
  }
  .iconbtn:hover { color: var(--accent-ink); background: var(--accent-bg); }
  .iconbtn.del:hover { color: var(--danger); background: var(--danger-bg); }
  .iconbtn i { font-size: 18px; }

  .afoot {
    margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--divider);
    display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  }
  .meta { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--text-2); }
  .meta i { font-size: 14px; color: var(--accent-ink); }
  .meta.warn { color: var(--caution); }
  .meta.warn i { color: var(--caution); }

  /* ── Side panels ── */
  .side { display: flex; flex-direction: column; gap: 16px; }
  .panel {
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-sm);
    padding: 18px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .ptitle { display: flex; align-items: center; gap: 8px; }
  .ptitle i { font-size: 17px; color: var(--accent-ink); }
  .ptitle h2 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: var(--text); }
  .panel textarea { resize: vertical; min-height: 64px; }
  .panel select { cursor: pointer; }
  .createbtn { width: 100%; cursor: pointer; }

  /* Featured accent card */
  .feature {
    position: relative; overflow: hidden;
    background: var(--accent-grad); color: var(--accent-t);
    border-radius: var(--r-lg);
    padding: 22px;
    box-shadow: 0 12px 32px var(--accent-glow);
  }
  .feature .watermark {
    position: absolute; right: -18px; top: -18px;
    font-size: 110px; opacity: 0.14; pointer-events: none;
  }
  .feature h3 { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 8px; }
  .feature p { font-size: 13px; line-height: 1.55; margin: 0; opacity: 0.85; }

  /* ── Empty state ── */
  .blankstate {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 64px 24px; text-align: center;
    border-radius: var(--r-lg);
  }
  .blankstate i { font-size: 40px; color: var(--text-3); }
  .blankstate p { margin: 0; font-size: 14px; color: var(--text-2); max-width: 400px; }

  @media (max-width: 880px) {
    .cols { grid-template-columns: 1fr; }
    h1 { font-size: 26px; }
  }
</style>
