<script>
  // The Emblem mark, the REEF glyph (Judah's pick, 2026-07-06): a coral branch,
  // one trunk forking into three limbs, each ending in a small glowing node.
  // Coral-to-rust gradient on the branches, a soft sea-glass rim behind them.
  // Reads as "one root, many capable branches." Vector, crisp anywhere,
  // identical in both themes. `size` is the rendered diameter.
  export let size = 28;
  export let glow = false;
  // Unique gradient ids per instance, several logos render on one page, and
  // duplicate SVG ids break if the first instance is hidden.
  const uid = Math.random().toString(36).slice(2, 8);
</script>

<svg width={size} height={size} viewBox="0 0 100 100" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
     style={glow ? "filter: drop-shadow(0 0 8px var(--accent-glow));" : ""}>
  <defs>
    <linearGradient id="branch-{uid}" x1="50" y1="100" x2="50" y2="8" gradientUnits="userSpaceOnUse">
      <stop offset="0%"  stop-color="#7a3a22"/>
      <stop offset="55%" stop-color="#d9603f"/>
      <stop offset="100%" stop-color="#f0987a"/>
    </linearGradient>
  </defs>

  <!-- sea-glass rim, glowing behind the branches -->
  <g fill="none" stroke="#8fd9c4" stroke-opacity="0.35" stroke-width="15"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M50 90 C 50 74, 50 66, 50 58"/>
    <path d="M50 58 C 40 48, 30 38, 23 27"/>
    <path d="M50 58 C 51 42, 52 26, 53 13"/>
    <path d="M50 58 C 60 50, 70 42, 77 31"/>
  </g>

  <!-- the coral branches themselves -->
  <g fill="none" stroke="url(#branch-{uid})" stroke-width="10"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M50 90 C 50 74, 50 66, 50 58"/>
    <path d="M50 58 C 40 48, 30 38, 23 27"/>
    <path d="M50 58 C 51 42, 52 26, 53 13"/>
    <path d="M50 58 C 60 50, 70 42, 77 31"/>
  </g>

  <!-- glowing tip nodes -->
  <circle cx="23" cy="27" r="7"   fill="#f0987a"/>
  <circle cx="53" cy="13" r="7.5" fill="#f2f6f3"/>
  <circle cx="77" cy="31" r="7"   fill="#f0987a"/>
</svg>
