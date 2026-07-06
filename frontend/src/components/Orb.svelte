<script>
  // Emblem's mark: a single breathing point of light on black.
  // One component powers the onboarding scene, voice mode, the FAB, and thinking dots.
  //
  // Props:
  //   size, px diameter of the core (halo extends beyond it)
  //   state, idle | listening | thinking | speaking | off
  //   level, 0..1 live mic/voice level (optional; drives glow intensity while listening)
  export let size = 72;
  export let state = "idle";
  export let level = 0;

  // Breathing speed per state: calm at rest, quick when thinking, rippling when speaking.
  $: speed = { idle: "3.2s", listening: "2.2s", thinking: "1.1s", speaking: "0.9s", off: "0s" }[state] ?? "3.2s";
  $: boost = state === "listening" ? Math.min(1, 0.35 + level * 1.4) : 1;
</script>

<span
  class="orb {state}"
  style="--d:{size}px; --speed:{speed}; --boost:{boost};"
  aria-hidden="true"
>
  <span class="halo"></span>
  <span class="rim"></span>
  <span class="core"></span>
  <span class="bubbles" aria-hidden="true">
    <span class="bubble b1"></span>
    <span class="bubble b2"></span>
    <span class="bubble b3"></span>
  </span>
  {#if state === "speaking"}
    <span class="ripple r1"></span>
    <span class="ripple r2"></span>
  {/if}
</span>

<style>
  .orb {
    position: relative;
    width: var(--d);
    height: var(--d);
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
  }
  /* the soft light that breathes */
  .halo {
    position: absolute;
    inset: calc(var(--d) * -0.55);
    border-radius: 50%;
    background: radial-gradient(circle,
      var(--glow-soft) 0%,
      var(--glow-rim) 42%,
      transparent 70%);
    opacity: calc(0.65 * var(--boost));
    animation: throb var(--speed) ease-in-out infinite;
    will-change: transform, opacity;
  }
  /* faint rim just outside the core */
  .rim {
    position: absolute;
    inset: calc(var(--d) * -0.12);
    border-radius: 50%;
    background: radial-gradient(circle, transparent 55%, var(--glow-rim) 72%, transparent 88%);
    animation: throb var(--speed) ease-in-out infinite;
    animation-delay: calc(var(--speed) / -3);
  }
  /* the glossy bioluminescent core: bright foam-sea-glass center warming to
     a coral edge and settling into the deep teal keel */
  .core {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 32%,
      #f7fffc 0%, #cdf2e6 16%, #e8724c 46%, #8a3f26 74%, #0f363c 100%);
    box-shadow: inset 0 calc(var(--d) * -0.06) calc(var(--d) * 0.14) rgba(0, 0, 0, 0.35),
                0 0 calc(var(--d) * 0.35) var(--glow-soft);
    animation: throb var(--speed) ease-in-out infinite;
  }
  /* rising bubbles drifting up through the core, underwater breathing motif */
  .bubbles {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 50%;
    pointer-events: none;
  }
  .bubble {
    position: absolute;
    bottom: 6%;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%,
      #ffffff 0%, rgba(255, 255, 255, 0.55) 55%, rgba(255, 255, 255, 0) 100%);
    opacity: 0;
    animation: rise var(--speed) ease-in infinite;
  }
  .bubble.b1 { left: 30%; width: calc(var(--d) * 0.10); height: calc(var(--d) * 0.10); animation-delay: 0s; }
  .bubble.b2 { left: 52%; width: calc(var(--d) * 0.065); height: calc(var(--d) * 0.065); animation-delay: calc(var(--speed) / -2.4); }
  .bubble.b3 { left: 41%; width: calc(var(--d) * 0.045); height: calc(var(--d) * 0.045); animation-delay: calc(var(--speed) / -1.3); }
  .orb.off .halo, .orb.off .rim, .orb.off .core, .orb.off .bubble { animation: none; opacity: 0.4; }
  .orb.thinking .halo { opacity: 0.45; }

  /* speaking: slow rings leaving the core */
  .ripple {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid var(--glow-soft);
    animation: pulse-ring 1.6s ease-out infinite;
  }
  .ripple.r2 { animation-delay: 0.8s; }
</style>
