<script>
  // The Emblem mark — the AURORA orb (Judah's reference, 2026-07-05): a glossy
  // near-black sphere with a crimson bloom, a thin electric-blue rim, and a
  // white four-point sparkle riding the upper right. Vector — crisp anywhere,
  // identical in both themes. `size` is the rendered diameter.
  export let size = 28;
  export let glow = false;
  // Unique gradient ids per instance — several logos render on one page, and
  // duplicate SVG ids break if the first instance is hidden.
  const uid = Math.random().toString(36).slice(2, 8);
</script>

<svg width={size} height={size} viewBox="0 0 100 100" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
     style={glow ? "filter: drop-shadow(0 0 8px var(--accent-glow));" : ""}>
  <defs>
    <radialGradient id="orb-shade-{uid}" cx="38%" cy="32%" r="78%">
      <stop offset="0%"  stop-color="#ffeef2"/>
      <stop offset="18%" stop-color="#f27b7e"/>
      <stop offset="45%" stop-color="#a92d44"/>
      <stop offset="74%" stop-color="#3a1030"/>
      <stop offset="100%" stop-color="#12081c"/>
    </radialGradient>
    <radialGradient id="orb-sheen-{uid}" cx="34%" cy="26%" r="38%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <circle cx="50" cy="50" r="45" fill="url(#orb-shade-{uid})"/>
  <!-- top-left specular -->
  <circle cx="50" cy="50" r="45" fill="url(#orb-sheen-{uid})"/>
  <!-- electric-blue rim -->
  <circle cx="50" cy="50" r="44.5" stroke="#5a7cf0" stroke-opacity="0.55" stroke-width="1.4"/>
  <!-- the four-point sparkle -->
  <path d="M72 12 C 74 24, 78 28, 90 30 C 78 32, 74 36, 72 48 C 70 36, 66 32, 54 30 C 66 28, 70 24, 72 12 Z"
        fill="#ffffff" fill-opacity="0.96"/>
</svg>
