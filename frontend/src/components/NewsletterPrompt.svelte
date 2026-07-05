<script>
  // The weekly newsletter nudge — shown ONLY to members who never decided
  // (newsletter_opt IS NULL) and at most once a week. The server timestamp is
  // the single source of truth; every button records the answer server-side.
  import { createEventDispatcher } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { api } from "../lib/api.js";
  import { notify } from "../lib/store.js";
  const dispatch = createEventDispatcher();

  let busy = false;
  async function choose(choice) {
    if (busy) return;
    busy = true;
    try {
      await api.newsletterOpt(choice);
      if (choice === "in") notify("You're in — the occasional good stuff, no noise.", "safe");
    } catch (e) { console.error("newsletter opt failed:", e); }
    dispatch("close");
  }
</script>

<div class="veil" on:click|self={() => choose("later")} transition:fade={{ duration: 150 }} role="presentation">
  <div class="card glass gloss" transition:fly={{ y: 12, duration: 220 }} role="dialog"
       aria-label="Newsletter invitation">
    <div class="ic"><i class="ti ti-mail-heart"></i></div>
    <h3>Want the Emblem newsletter?</h3>
    <p>Occasional product news and genuinely useful tips — no noise, and one click to leave anytime.</p>
    <button class="primaryb" on:click={() => choose("in")} disabled={busy}>Count me in</button>
    <div class="row">
      <button class="quiet" on:click={() => choose("later")} disabled={busy}>Not now</button>
      <button class="quiet" on:click={() => choose("out")} disabled={busy}>No thanks — don't ask again</button>
    </div>
  </div>
</div>

<style>
  .veil { position: fixed; inset: 0; z-index: 110; background: rgba(0,0,0,0.45);
    -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    display: grid; place-items: center; padding: 20px; }
  .card { width: min(400px, 100%); border-radius: var(--r-seal); padding: 26px 26px 20px;
    display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
    box-shadow: var(--shadow-lg); }
  .ic { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
    background: var(--accent-bg); color: var(--accent-ink); font-size: 23px; }
  h3 { margin: 2px 0 0; font-size: 18px; color: var(--text); }
  p { margin: 0 0 8px; font-size: 14px; color: var(--text-2); line-height: 1.6; }
  .primaryb { width: 100%; padding: 12px; border-radius: var(--r-pill); background: var(--accent-grad);
    color: var(--accent-t); font-size: 14.5px; font-weight: 500; cursor: pointer;
    box-shadow: 0 0 16px var(--accent-glow); }
  .row { display: flex; gap: 18px; }
  .quiet { color: var(--text-3); font-size: 12.5px; cursor: pointer; }
  .quiet:hover { color: var(--text-2); }
</style>
