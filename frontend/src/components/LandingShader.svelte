<script>
  // The Stitch "liquid gradient" hero background (stitch_emblem_core_ui/shader):
  // a near-white moving field with a mouse-following electric-blue tint.
  // Pure WebGL, no dependencies; renders nothing (transparent fallback) when
  // WebGL is unavailable or reduced motion is requested.
  import { onMount, onDestroy } from "svelte";

  let canvas;
  let raf = 0;
  let cleanup = () => {};

  onMount(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return;

    const dark = () => document.documentElement.dataset.theme === "dark";

    function syncSize() {
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);
    syncSize();

    const vs = `attribute vec2 a_position; varying vec2 v_texCoord;
      void main(){ v_texCoord = a_position * 0.5 + 0.5; gl_Position = vec4(a_position,0.,1.);}`;
    const fs = `precision highp float;
      varying vec2 v_texCoord;
      uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse; uniform float u_dark;
      void main(){
        vec2 uv = v_texCoord;
        vec2 mouse = u_mouse / u_resolution;
        float dist = distance(uv, mouse);
        vec3 base1 = mix(vec3(0.98, 0.98, 1.0), vec3(0.055, 0.06, 0.07), u_dark);
        vec3 base2 = mix(vec3(1.0, 1.0, 1.0),   vec3(0.043, 0.047, 0.055), u_dark);
        vec3 accent = vec3(0.0, 0.32, 1.0);
        float noise = sin(uv.x * 10.0 + u_time) * cos(uv.y * 10.0 + u_time) * 0.1;
        float influence = smoothstep(0.4, 0.0, dist + noise);
        vec3 finalColor = mix(base1, base2, uv.y);
        finalColor = mix(finalColor, accent, influence * (0.05 + 0.03 * u_dark));
        gl_FragColor = vec4(finalColor, 1.0);
      }`;
    const cs = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");
    const uDark = gl.getUniformLocation(prog, "u_dark");

    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width && r.height) {
        mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
        mouse.y = (1 - (e.clientY - r.top) / r.height) * canvas.height;
      }
    };
    window.addEventListener("mousemove", onMove);

    function render(t) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      if (uDark) gl.uniform1f(uDark, dark() ? 1.0 : 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    }
    raf = requestAnimationFrame(render);

    cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      ro.disconnect();
    };
  });

  onDestroy(() => cleanup());
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
