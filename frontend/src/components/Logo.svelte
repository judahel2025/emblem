<script>
  // The Emblem mark — the moss orb: the same luminous sphere that floats on the
  // landing hero (Judah's pick, 2026-07-05). A shaded Verdant globe with a fine
  // wireframe shell, drawn as vector so it's crisp at any size and identical in
  // both themes. `size` is the rendered diameter.
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
    <radialGradient id="orb-shade-{uid}" cx="36%" cy="30%" r="75%">
      <stop offset="0%"  stop-color="#e8d7ae"/>
      <stop offset="45%" stop-color="#c09a5e"/>
      <stop offset="80%" stop-color="#8b6530"/>
      <stop offset="100%" stop-color="#4a3619"/>
    </radialGradient>
    <radialGradient id="orb-sheen-{uid}" cx="32%" cy="24%" r="40%">
      <stop offset="0%" stop-color="#f6efe0" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#f6efe0" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="orb-clip-{uid}"><circle cx="50" cy="50" r="46"/></clipPath>
  </defs>

  <circle cx="50" cy="50" r="46" fill="url(#orb-shade-{uid})"/>

  <!-- wireframe shell — longitude + latitude, clipped to the globe -->
  <g clip-path="url(#orb-clip-{uid})" stroke="#f0e6cd" stroke-opacity="0.28" stroke-width="1.1" fill="none">
    <ellipse cx="50" cy="50" rx="46" ry="46"/>
    <ellipse cx="50" cy="50" rx="30" ry="46"/>
    <ellipse cx="50" cy="50" rx="12" ry="46"/>
    <ellipse cx="50" cy="50" rx="46" ry="30"/>
    <ellipse cx="50" cy="50" rx="46" ry="12"/>
  </g>

  <!-- top-left light -->
  <circle cx="50" cy="50" r="46" fill="url(#orb-sheen-{uid})"/>
  <!-- rim -->
  <circle cx="50" cy="50" r="45.5" stroke="#4a3619" stroke-opacity="0.55" stroke-width="1"/>
</svg>
