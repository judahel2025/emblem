<script>
  // Shell for connector workspaces: resolves appView "workspace:<slug>",
  // lazy-loads the component, and renders shared loading/error/approval chrome.
  import { fly } from "svelte/transition";
  import { appView } from "../../lib/store.js";
  import { WORKSPACES } from "../../lib/workspaces.js";
  import ApprovalCard from "../../components/ApprovalCard.svelte";

  export let slug;

  $: entry = WORKSPACES[slug];

  // One shared approval surface for all workspaces: children call
  // onApproval(info) (from runConnected) and we render the card here.
  let pendingApproval = null;
  function onApproval(info) {
    pendingApproval = {
      ...info,
      approve: async () => { const p = pendingApproval; pendingApproval = null; await p.__approve(); },
      decline: async () => { const p = pendingApproval; pendingApproval = null; await p.__decline(); },
      __approve: info.approve,
      __decline: info.decline,
    };
  }
</script>

<div class="ws">
  <header class="ws-head">
    <button class="back" on:click={() => appView.set("connect")} aria-label="Back to Connections">
      <i class="ti ti-arrow-left"></i>
    </button>
    {#if entry}
      <span class="ws-icon"><i class="ti {entry.icon}"></i></span>
      <div class="ws-titles">
        <h1>{entry.label}</h1>
        <p>{entry.blurb}, actions always ask first.</p>
      </div>
    {/if}
  </header>

  {#if entry}
    {#await entry.load()}
      <div class="ws-loading"><span class="spin"></span> Opening {entry.label}…</div>
    {:then mod}
      <svelte:component this={mod.default} {onApproval} />
    {:catch err}
      <div class="empty">Couldn't open this workspace. {err?.message || ""}</div>
    {/await}
  {:else}
    <div class="empty">This app doesn't have a workspace yet.</div>
  {/if}

  {#if pendingApproval}
    <!-- Workspace approvals resolve in place via runConnected's own approve/
         decline callbacks, the shared card is visual only here, so it gets
         callback props instead of the store's decideAndContinue flow. -->
    <div class="ap-veil">
      <div class="ap-holder" in:fly={{ y: 14, duration: 220 }}>
        <ApprovalCard
          approval={{ id: pendingApproval.approval_id, summary: pendingApproval.summary, args_json: pendingApproval.args_json }}
          variant="modal"
          onApprove={pendingApproval.approve}
          onDecline={pendingApproval.decline}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .ws { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ws-head {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .back {
    width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center;
    color: var(--text-3); font-size: 17px; cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .back:hover { background: var(--s2); color: var(--text); }
  .ws-icon {
    width: 34px; height: 34px; border-radius: 10px;
    background: var(--s2); color: var(--accent-ink);
    display: grid; place-items: center; font-size: 19px;
  }
  .ws-titles h1 { margin: 0; font-size: 16px; font-weight: 500; color: var(--text); }
  .ws-titles p { margin: 0; font-size: 12px; color: var(--text-3); }
  .ws-loading {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px;
    color: var(--text-3); font-size: 14px;
  }

  .ap-veil {
    position: fixed; inset: 0; z-index: 80;
    background: rgba(0, 0, 0, 0.45);
    display: grid; place-items: center;
  }
  .ap-holder { max-width: calc(100vw - 40px); }
</style>
