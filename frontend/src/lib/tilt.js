// Cursor-tracking tilt, the Stitch design system's signature card motion:
// a subtle 3D tilt + light refraction that follows the cursor with slight lag.
// Usage: <div use:tilt> or <div use:tilt={{ max: 6 }}>. No-ops under
// prefers-reduced-motion and on touch-only devices.
export function tilt(node, opts = {}) {
  const max = opts.max ?? 4;           // degrees
  const perspective = opts.perspective ?? 700;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  if (reduced || coarse) return {};

  node.style.transition = "transform 0.1s ease-out";
  node.style.willChange = "transform";

  function onMove(e) {
    const r = node.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    node.style.transform =
      `perspective(${perspective}px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg)`;
  }
  function onLeave() {
    node.style.transform = "perspective(700px) rotateX(0deg) rotateY(0deg)";
  }

  node.addEventListener("mousemove", onMove);
  node.addEventListener("mouseleave", onLeave);
  return {
    destroy() {
      node.removeEventListener("mousemove", onMove);
      node.removeEventListener("mouseleave", onLeave);
    },
  };
}
