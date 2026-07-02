<script>
  import { onMount, onDestroy } from "svelte";

  export let state = "idle"; // idle | listening | thinking | speaking
  export let stream = null;  // MediaStream when listening

  let bars = [4, 4, 4, 4, 4];
  let raf;
  let analyser = null;
  let dataArray = null;
  let audioCtx = null;
  let source = null;
  let spinAngle = 0;
  let lastTime = 0;

  $: if (stream && state === "listening") {
    connectStream(stream);
  } else {
    disconnectStream();
  }

  function connectStream(s) {
    try {
      disconnectStream();
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      source = audioCtx.createMediaStreamSource(s);
      source.connect(analyser);
    } catch {}
  }

  function disconnectStream() {
    try { source?.disconnect(); } catch {}
    try { audioCtx?.close(); } catch {}
    analyser = null; dataArray = null; source = null; audioCtx = null;
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    const dt = ts - lastTime;
    lastTime = ts;

    if (state === "listening" && analyser && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      bars = [0, 2, 4, 2, 0].map((offset, i) => {
        const raw = (dataArray[offset] ?? 0) / 255;
        const target = raw * 36 + 4;
        return bars[i] + (target - bars[i]) * 0.25;
      });
    } else if (state === "speaking") {
      const t = ts / 600;
      bars = bars.map((_, i) => {
        const wave = Math.sin(t + i * 0.9) * 0.5 + 0.5;
        return wave * 18 + 4;
      });
    } else if (state === "thinking") {
      spinAngle += dt * 0.004;
    } else {
      // idle — breathe gently
      const t = ts / 1800;
      bars = bars.map((_, i) => Math.sin(t + i * 0.4) * 2 + 5);
    }
  }

  onMount(() => { raf = requestAnimationFrame(tick); });
  onDestroy(() => { cancelAnimationFrame(raf); disconnectStream(); });
</script>

<div class="waveform" class:thinking={state === "thinking"}>
  {#if state === "thinking"}
    <div class="spinner" style="transform: rotate({spinAngle}rad)">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border-strong)" stroke-width="2"/>
        <path d="M10 2 A8 8 0 0 1 18 10" fill="none" stroke="var(--accent-t)" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
  {:else}
    <div class="bars">
      {#each bars as h, i}
        <div class="bar" class:active={state !== "idle"}
          style="height:{h}px; opacity:{state === 'idle' ? 0.35 : 0.85};">
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .waveform {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 32px;
    flex-shrink: 0;
  }

  .bars {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 100%;
  }

  .bar {
    width: 3px;
    border-radius: 2px;
    background: var(--accent-t);
    transition: height 0.05s ease, opacity 0.2s;
    min-height: 3px;
  }

  .bar.active { background: var(--accent-t); }

  .spinner { display: flex; align-items: center; justify-content: center; }
</style>
