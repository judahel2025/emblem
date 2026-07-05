<script>
  // The Stitch hero orb (stitch_emblem_core_ui/three.js): an electric-blue
  // sphere with a wireframe shell that rotates, floats, and follows the cursor.
  // three.js loads lazily AFTER first paint (its chunk never blocks the page);
  // until then — and wherever WebGL/motion is unavailable — the CSS orb shows.
  import { onMount, onDestroy } from "svelte";
  import Orb from "./Orb.svelte";

  let host;
  let ready = false;
  let cleanup = () => {};

  onMount(async () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let THREE;
    try { THREE = await import("three"); } catch (e) {
      console.warn("3d orb unavailable:", e?.message || e);
      return;
    }
    if (!host) return;

    const width = host.clientWidth || 360;
    const height = host.clientHeight || 360;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    host.appendChild(renderer.domElement);

    // AURORA: a glossy dark sphere with a crimson undertone and a faint
    // electric-blue wire shell — the reference's orb, in three.js.
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 64, 64),
      new THREE.MeshPhongMaterial({
        color: 0x1a2340, transparent: true, opacity: 0.92,
        shininess: 160, emissive: 0x3e1220,
      }));
    scene.add(orb);

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x5a7cf0, wireframe: true, transparent: true, opacity: 0.12,
      }));
    scene.add(shell);

    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(5, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    camera.position.z = 5;

    let mouseX = 0, mouseY = 0;
    const onMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onMove);

    const onResize = () => {
      const w = host.clientWidth || width, h = host.clientHeight || height;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    function animate(t) {
      raf = requestAnimationFrame(animate);
      orb.rotation.y += 0.005;
      shell.rotation.y -= 0.003;
      orb.position.y = Math.sin(t * 0.001) * 0.1 + (mouseY * 0.5 - orb.position.y) * 0.05 + orb.position.y * 0.95;
      orb.position.x += (mouseX * 0.5 - orb.position.x) * 0.05;
      shell.position.copy(orb.position);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(animate);
    ready = true;

    cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      try { host.removeChild(renderer.domElement); } catch {}
    };
  });

  onDestroy(() => cleanup());
</script>

<div class="orb3d" bind:this={host} aria-hidden="true">
  {#if !ready}
    <div class="fallback"><Orb size={120} state="idle" /></div>
  {/if}
</div>

<style>
  .orb3d { position: relative; width: min(380px, 70vw); height: min(380px, 70vw); margin: 0 auto; }
  .fallback { position: absolute; inset: 0; display: grid; place-items: center; }
</style>
