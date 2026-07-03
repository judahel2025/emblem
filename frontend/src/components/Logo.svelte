<script>
  // The Emblem mark — "Arc-E" (white-hot mono): a dim orbit ring with one
  // luminous arc segment, three E strokes, and the orbit dot. currentColor
  // drives it so it reads as ink on light and white-hot on dark.
  export let size = 28;
  export let glow = false;
</script>

<svg width={size} height={size} viewBox="0 0 100 100" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
     style={glow ? "filter: drop-shadow(0 0 6px var(--accent-glow));" : ""}>
  <circle cx="50" cy="50" r="43" stroke="currentColor" stroke-width="5" opacity="0.28"/>
  <circle cx="50" cy="50" r="43" stroke="currentColor" stroke-width="5"
          stroke-dasharray="46 224" stroke-linecap="round"
          transform="rotate(-32 50 50)"/>
  <path d="M34 35H66M34 50H57M34 65H66" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  <circle cx="68" cy="50" r="5.5" fill="currentColor"/>
</svg>
