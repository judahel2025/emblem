<script>
  // Shared approval card (WHITE-HOT MONO): used inline in the chat's approvals
  // bar and as the modal card inside workspace veils. The parent owns the
  // lifecycle, it drives `state` (idle | running | done | error) via props or
  // bind, and reacts to approve/decline events (or passes callback props).
  import { createEventDispatcher } from "svelte";
  import { slide } from "svelte/transition";

  export let approval = {};          // { id, summary, args_json? }
  export let variant = "inline";     // "inline" | "modal"
  export let state = "idle";         // idle | running | done | error (bindable)
  export let error = "";             // message shown in the error state
  export let onApprove = null;       // optional callback, overrides nothing, just runs
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

  // The moment of sealing: timestamped in mono, kept in the done state, the
  // one permanent visual trace a completed action leaves.
  let sealedAt = "";
  const stampTime = () => new Date().toLocaleTimeString([], { hour12: false });

  function approve() {
    if (state !== "idle") return;
    choice = "approve";
    sealedAt = stampTime();
    if (onApprove) onApprove();
    dispatch("approve", { id: approval.id, summary: approval.summary });
  }
  function decline() {
    if (state !== "idle") return;
    choice = "decline";
    sealedAt = stampTime();
    if (onDecline) onDecline();
    dispatch("decline", { id: approval.id, summary: approval.summary });
  }
</script>

<div class="ap-card glass gloss {variant}" class:settled={state !== "idle"}>
  <!-- Header chip, ochre: waiting on the user. The shield is the signet; it
       plays the press when the seal is applied. -->
  <div class="ap-head">
    <span class="ap-chip" class:stamping={state === "running" && choice === "approve"}>
      <i class="ti ti-shield-half-filled"></i> Approval needed</span>
  </div>
  <p class="ap-summary">{approval.summary}</p>

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
    <!-- Option rows, like the AskUserQuestion answer buttons -->
    <div class="ap-options">
      <button class="ap-option approve" on:click={approve}>
        <span class="ap-opt-key"><i class="ti ti-check"></i></span>
        <span class="ap-opt-label">Approve</span>
        <span class="ap-opt-hint">run it now</span>
      </button>
      <button class="ap-option decline" on:click={decline}>
        <span class="ap-opt-key"><i class="ti ti-x"></i></span>
        <span class="ap-opt-label">Decline</span>
        <span class="ap-opt-hint">don't run</span>
      </button>
    </div>
    <p class="ap-foot">Nothing happens until you choose.</p>
  {:else if state === "running"}
    <div class="ap-status">
      <span class="ap-spin" aria-hidden="true"></span>
      {choice === "decline" ? "Declining…" : "Approved, running…"}
    </div>
  {:else if state === "done"}
    {#if choice === "decline"}
      <div class="ap-status"><i class="ti ti-x"></i> Declined <span class="ap-stamp">· {sealedAt}</span></div>
    {:else}
      <div class="ap-status sealed"><i class="ti ti-check"></i> Sealed <span class="ap-stamp">· {sealedAt}</span></div>
    {/if}
  {:else if state === "error"}
    <div class="ap-status error">
      <i class="ti ti-alert-triangle"></i> {error || "The action failed."}
    </div>
  {/if}
</div>

<style>
  .ap-card {
    border-radius: var(--r-tide);
    box-shadow: var(--edge-red), var(--shadow-md);
    display: flex; flex-direction: column; gap: 10px;
    transition: opacity var(--t-fast);
  }
  .ap-card.settled { gap: 8px; }

  /* ── inline: compact card for the chat approvals bar ─────────── */
  .ap-card.inline { padding: 14px 16px; width: 100%; }

  /* ── modal: centered sheet inside a workspace veil ────────────── */
  .ap-card.modal {
    width: min(440px, calc(100vw - 40px));
    padding: 22px 22px 18px;
    box-shadow: var(--shadow-lg);
  }

  /* Header chip, the small tag above the question (AskUserQuestion style) */
  .ap-head { display: flex; align-items: center; }
  .ap-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: var(--r-pill);
    background: var(--blue-bg); border: 1px solid var(--blue);
    font-size: 11.5px; font-weight: 500; letter-spacing: 0.01em;
    color: var(--blue-h);   /* blue, waiting on the user */
  }
  .ap-chip i { font-size: 13px; }
  /* The stamp: weight applied, then settling, no bounce, no overshoot. */
  .ap-chip.stamping i { animation: stamp-press 200ms cubic-bezier(0.4, 0, 0.2, 1); }
  @keyframes stamp-press {
    0%   { transform: scale(1); }
    45%  { transform: scale(0.92); }
    100% { transform: scale(1); }
  }

  .ap-summary {
    margin: 0; font-size: 15px; font-weight: 500; line-height: 1.45;
    color: var(--text); overflow-wrap: break-word;
  }

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
    font-size: 11.5px; font-weight: 500; color: var(--text-3);
    text-transform: lowercase; letter-spacing: 0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ap-kv dd {
    margin: 0; min-width: 0; flex: 1;
    font-size: 12.5px; color: var(--text-2); line-height: 1.45;
    overflow-wrap: anywhere;
  }

  /* Option rows, selectable answer buttons, like Claude's question card */
  .ap-options { display: flex; flex-direction: column; gap: 7px; margin-top: 2px; }
  .ap-option {
    display: flex; align-items: center; gap: 11px; text-align: left;
    padding: 11px 13px; border-radius: var(--r-md);
    background: var(--s1); border: 1px solid var(--border);
    transition: border-color var(--t-fast), background var(--t-fast), transform var(--t-fast);
  }
  .ap-option:hover { transform: translateY(-1px); }
  .ap-opt-key {
    width: 24px; height: 24px; border-radius: var(--r-sm); flex-shrink: 0;
    display: grid; place-items: center; font-size: 14px;
    background: var(--s3); color: var(--text-2);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .ap-opt-label { font-size: 14px; font-weight: 500; color: var(--text); }
  .ap-opt-hint { margin-left: auto; font-size: 12px; color: var(--text-3); }

  .ap-option.approve:hover {
    border-color: var(--accent); background: var(--accent-bg);
  }
  .ap-option.approve:hover .ap-opt-key {
    background: var(--accent-grad); color: var(--accent-t);
    box-shadow: 0 0 12px var(--accent-glow);
  }
  .ap-option.decline:hover { border-color: var(--danger); }
  .ap-option.decline:hover .ap-opt-key,
  .ap-option.decline:hover .ap-opt-label { color: var(--danger); }

  .ap-foot { margin: 2px 0 0; font-size: 11.5px; color: var(--text-3); }

  .ap-status {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 500; color: var(--text-2);
    min-height: 32px;
  }
  .ap-status.sealed { color: var(--accent-ink); font-weight: 500; }  /* brass, Emblem sealed it */
  .ap-status.sealed i { font-size: 16px; }
  .ap-stamp { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-3); }
  .ap-status.error { color: var(--danger); }
  .ap-status.error i { font-size: 15px; flex-shrink: 0; }

  .ap-spin {
    width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--border-strong); border-top-color: var(--accent);
    animation: ap-rotate 0.7s linear infinite;
  }
  @keyframes ap-rotate { to { transform: rotate(360deg); } }
</style>
