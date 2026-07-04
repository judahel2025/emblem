<script>
  // The Emblem mark — the ribbon "E": an uppercase E drawn from two stacked
  // ribbon/wing curves (a top curve sweeping right into the top + middle arms,
  // a matching bottom curve for the lower arm) with a four-point sparkle to the
  // right of the middle arm. Flattened to mono: currentColor reads as ink on
  // light and white-hot on dark; the sparkle takes a lighter second tone.
  export let size = 28;
  export let glow = false;
</script>

<svg width={size} height={size} viewBox="0 0 100 100" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
     style={glow ? "filter: drop-shadow(0 0 7px var(--accent-glow));" : ""}>
  <!-- top wing → spine → middle arm, one folded ribbon curve -->
  <path d="M74 30 C 55 24, 35 25, 28 34 L28 47 C 40 47, 52 48, 61 51"
        stroke="currentColor" stroke-width="11"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- lower wing → spine base -->
  <path d="M28 50 L28 66 C 33 76, 55 77, 74 70"
        stroke="currentColor" stroke-width="11"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- four-point sparkle, right of the middle arm -->
  <path d="M79 37 C 80 44, 81 45, 88 46 C 81 47, 80 48, 79 55
           C 78 48, 77 47, 70 46 C 77 45, 78 44, 79 37 Z"
        fill="currentColor" opacity="0.78"/>
</svg>
