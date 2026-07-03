<script>
  // Shared approval card (WHITE-HOT MONO): used inline in the chat's approvals
  // bar and as the modal card inside workspace veils. The parent owns the
  // lifecycle — it drives `state` (idle | running | done | error) via props or
  // bind, and reacts to approve/decline events (or passes callback props).
  import { createEventDispatcher } from "svelte";
  import { slide } from "svelte/transition";

  export let approval = {};          // { id, summary, args_json? }
  export let variant = "inline";     // "inline" | "modal"
  export let state = "idle";         // idle | running | done | error (bindable)
  export let error = "";             // message shown in the error state
  export let onApprove = null;       // optional callback — overrides nothing, just runs
  export let onDecline = null;

  const dispatch = createEventDispatcher();

  let showDetails = false;
  let choice = null;                 // which button was pressed (for running copy)

  // args_json → pretty key: value pairs. Secrets never render; long values clip.
  const SECRET_KEY = /(token|key|secret|password)/i;
  $: details = parseArgs(approval?.args_json);
  function parseArgs(raw) {
    if (!raw) return [];
    let obj = raw;
    if (typeof raw === "string") {
      try { obj = JSON.parse(raw); } catch { return []; }
    }
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj)
      .filter(([k]) => !SECRET_KEY.test(k))
      .map(([k, v]) => {
        let val = typeof v === "string" ? v : JSON.stringify(v);
        if (val && val.length > 120) val = val.slice(0, 120) + "…";
        return { key: k, value: val ?? "" };
      });
  }

  function approve() {
    if (state !== "idle") return;
    choice = "approve";
    if (onApprove) onApprove();
    dispatch("approve", { id: approval.id, summary: approval.summary });
  }
  function decline() {
    if (state !== "idle") return;
    choice = "decline";
    if (onDecline) onDecline();
    dispatch("decline", { id: approval.id, summary: approval.summary });
  }
</script>

<div class="ap-card glass gloss {variant}" class:settled={state !== "idle"}>
  <div class="ap-top">
    <div class="ap-disc"><i class="ti ti-shield-check"></i></div>
    <div class="ap-info">
      <p class="ap-summary">{approval.summary}</p>
      {#if state === "idle"}
        <p class="ap-hint">Nothing happens until you decide.</p>
      {/if}
    </div>
  </div>

  {#if state === "idle" && details.length}
    <button class="ap-toggle" on:click={() => (showDetails = !showDetails)}>
      <i class="ti {showDetails ? 'ti-chevron-up' : 'ti-chevron-down'}"></i>
      {showDetails ? "Hide details" : "View details"}
    </button>
    {#if showDetails}
      <dl class="ap-details" transition:slide={{ duration: 180 }}>
        {#each details as d (d.key)}
          <div class="ap-kv">
            <dt>{d.key}</dt>
            <dd>{d.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  {/if}

  {#if state === "idle"}
    <div class="ap-btns">
      <button class="ap-approve" on:click={approve}>Approve</button>
      <button class="ap-decline" on:click={decline}>Decline</button>
    </div>
  {:else if state === "running"}
    <div class="ap-status">
      <span class="ap-spin" aria-hidden="true"></span>
      {choice === "decline" ? "Declining…" : "Approved — running…"}
    </div>
  {:else if state === "done"}
    <div class="ap-status done"><i class="ti ti-check"></i> Done</div>
  {:else if state === "error"}
    <div class="ap-status error">
      <i class="ti ti-alert-triangle"></i> {error || "The action failed."}
    </div>
  {/if}
</div>

<style>
  .ap-card {
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-md);
    display: flex; flex-direction: column; gap: 10px;
    transition: opacity var(--t-fast);
  }
  .ap-card.settled { gap: 6px; }

  /* ── inline: compact card for the chat approvals bar ─────────── */
  .ap-card.inline { padding: 13px 16px; width: 100%; }

  /* ── modal: centered sheet inside a workspace veil ────────────── */
  .ap-card.modal {
    width: min(440px, calc(100vw - 40px));
    padding: 26px 24px 22px;
    text-align: center;
    box-shadow: var(--shadow-lg);
  }
  .ap-card.modal .ap-top { flex-direction: column; align-items: center; gap: 12px; }
  .ap-card.modal .ap-info { align-items: center; }
  .ap-card.modal .ap-btns, .ap-card.modal .ap-status { justify-content: center; }
  .ap-card.modal .ap-toggle { align-self: center; }

  .ap-top { display: flex; align-items: center; gap: 13px; }

  /* Glow disc — white-hot ball of light, shield in ink */
  .ap-disc {
    width: 40px; height: 40px; border-radius: var(--r-pill); flex-shrink: 0;
    background: radial-gradient(circle at 35% 30%, var(--accent), var(--accent-2));
    color: var(--accent-t);
    box-shadow: 0 0 18px var(--accent-glow), 0 1px 3px var(--glow-rim);
    display: grid; place-items: center; font-size: 20px;
  }
  .ap-card.modal .ap-disc { width: 48px; height: 48px; font-size: 24px; }

  .ap-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ap-summary {
    margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.4;
    color: var(--text); overflow-wrap: break-word;
  }
  .ap-hint { margin: 0; font-size: 12px; color: var(--text-3); }

  .ap-toggle {
    align-self: flex-start;
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 0; font-size: 12px; font-weight: 500; color: var(--text-3);
    transition: color var(--t-fast);
  }
  .ap-toggle:hover { color: var(--text); }
  .ap-toggle i { font-size: 13px; }

  .ap-details {
    margin: 0; padding: 10px 12px;
    background: var(--s1); border: 1px solid var(--border);
    border-radius: var(--r-md);
    display: flex; flex-direction: column; gap: 6px;
    text-align: left;
  }
  .ap-kv { display: flex; gap: 10px; align-items: baseline; min-width: 0; }
  .ap-kv dt {
    flex-shrink: 0; max-width: 38%;
    font-size: 11.5px; font-weight: 600; color: var(--text-3);
    text-transform: lowercase; letter-spacing: 0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ap-kv dd {
    margin: 0; min-width: 0; flex: 1;
    font-size: 12.5px; color: var(--text-2); line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .ap-btns { display: flex; gap: 8px; }
  .ap-approve {
    padding: 8px 20px; border-radius: var(--r-sm);
    background: var(--accent-grad); color: var(--accent-t);
    font-size: 13px; font-weight: 600;
    box-shadow: 0 2px 10px var(--accent-glow);
    transition: filter var(--t-fast), box-shadow var(--t-fast);
  }
  .ap-approve:hover { filter: brightness(1.07); box-shadow: 0 2px 14px var(--accent-glow); }
  .ap-decline {
    padding: 8px 18px; border-radius: var(--r-sm);
    background: transparent; color: var(--text-2);
    border: 1px solid var(--border-strong);
    font-size: 13px; font-weight: 500;
    transition: color var(--t-fast), border-color var(--t-fast);
  }
  .ap-decline:hover { color: var(--danger); border-color: var(--danger); }

  .ap-status {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 500; color: var(--text-2);
    min-height: 32px;
  }
  .ap-status.done { color: var(--safe); font-weight: 600; }
  .ap-status.done i { font-size: 16px; }
  .ap-status.error { color: var(--danger); }
  .ap-status.error i { font-size: 15px; flex-shrink: 0; }

  .ap-spin {
    width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--border-strong); border-top-color: var(--accent);
    animation: ap-rotate 0.7s linear infinite;
  }
  @keyframes ap-rotate { to { transform: rotate(360deg); } }
</style>
