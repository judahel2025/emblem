<script>
  // The Emblem mark — Judah's Verdant infinity ribbon (raster, used exactly as
  // exported): the left loop reads as a lowercase "e", the crossover is the ∞,
  // the right loop holds the molecule/node network. 3D glossy moss — reads on
  // both the milk and warm-ink grounds, so one asset serves both themes.
  // `size` is the rendered HEIGHT; width follows the mark's native ratio.
  export let size = 28;
  export let glow = false;
</script>

<img
  src="/verdant-logo.png"
  alt=""
  aria-hidden="true"
  height={size}
  style="height:{size}px; width:auto; display:block; {glow ? 'filter: drop-shadow(0 0 7px var(--accent-glow));' : ''}"
/>
