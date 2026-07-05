<script>
  // The tour's visual layer: a dark veil with an animated spotlight cutout over
  // the current target, plus a caption card carrying the narration text.
  import { fade, fly } from "svelte/transition";
  import { tourState, next, prev, endTour } from "../lib/tour.js";

  const PAD = 10;
  const R = 14;

  $: s = $tourState;
  $: step = s ? s.steps[s.idx] : null;
  $: rect = s?.rect
    ? { x: s.rect.x - PAD, y: s.rect.y - PAD, w: s.rect.w + PAD * 2, h: s.rect.h + PAD * 2 }
    : null;
</script>

{#if s && step}
  <!-- No transition on this root: a hung out-transition would pin the overlay
       in the DOM forever. The card animates; the veil just appears/disappears. -->
  <div class="tour">
    <svg class="veil" width="100%" height="100%" aria-hidden="true">
      <defs>
        <mask id="spot">
          <rect width="100%" height="100%" fill="white" />
          {#if rect}
            <rect class="cutout" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={R} fill="black" />
          {/if}
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.62)" mask="url(#spot)" />
      {#if rect}
        <rect class="ring" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={R}
              fill="none" stroke="var(--accent)" stroke-width="2" />
      {/if}
    </svg>

    <div class="card glass gloss" in:fly={{ y: 16, duration: 250 }}>
      {#key s.idx}
        <div class="cap" in:fly={{ x: 18, duration: 260 }}>
          <p class="title">{step.title} <span class="count">{s.idx + 1}/{s.steps.length}</span></p>
          <p class="script">{step.script}</p>
        </div>
      {/key}
      <div class="row">
        <div class="dots" role="progressbar"
             aria-valuenow={s.idx + 1} aria-valuemin="1" aria-valuemax={s.steps.length}
             aria-label="Tour progress">
          {#each s.steps as _, i}
            <span class="dot" class:on={i === s.idx}></span>
          {/each}
        </div>
        <div class="btns">
          {#if s.idx > 0}
            <button class="ghost" on:click={prev}>Back</button>
          {/if}
          <button class="ghost" on:click={() => endTour(false)}>Skip tour</button>
          <button class="go" on:click={next}>
            {s.idx === s.steps.length - 1 ? "Start using Emblem" : "Next"}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .tour { position: fixed; inset: 0; z-index: 90; }
  .veil { position: absolute; inset: 0; pointer-events: auto; }
  .cutout, .ring { transition: x 0.35s var(--spring), y 0.35s var(--spring),
    width 0.35s var(--spring), height 0.35s var(--spring); }
  .ring { filter: drop-shadow(0 0 10px var(--accent-glow)); animation: ring-breathe 2.2s ease-in-out infinite; }
  @keyframes ring-breathe {
    0%, 100% { stroke-opacity: 1; }
    50%      { stroke-opacity: 0.55; }
  }

  .card {
    position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%);
    width: min(520px, calc(100vw - 40px));
    border-radius: var(--r-lg); padding: 18px 20px 14px;
    box-shadow: var(--shadow-lg);
  }
  .title { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: var(--text); }
  .count { font-size: 11.5px; font-weight: 500; color: var(--text-3); margin-left: 6px; letter-spacing: 0.06em; }
  .script { margin: 0 0 14px; font-size: 15.5px; line-height: 1.6; color: var(--text-2);
    font-family: var(--font-voice); font-style: italic; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .dots { display: flex; gap: 5px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border-strong);
    transition: background var(--t-fast), transform var(--t-fast); }
  .dot.on { background: var(--accent); transform: scale(1.3); }
  .btns { display: flex; align-items: center; gap: 8px; }
  .ghost { padding: 7px 12px; border-radius: var(--r-pill); font-size: 13px; color: var(--text-3);
    cursor: pointer; transition: color var(--t-fast); }
  .ghost:hover { color: var(--text); }
  .go { padding: 8px 18px; border-radius: var(--r-pill); font-size: 13.5px; font-weight: 500;
    background: var(--accent-grad); color: var(--accent-t); cursor: pointer;
    box-shadow: 0 2px 10px var(--accent-glow); transition: filter var(--t-fast); }
  .go:hover { filter: brightness(1.07); }
</style>
