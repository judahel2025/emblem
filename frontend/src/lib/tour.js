// Tour engine — a small step machine that drives the TourOverlay.
// For each step: switch the app view, wait for the target to mount, locate its
// rect, play the narration (cached server TTS; captions carry it if audio is
// unavailable), advance on audio end or Next. Deterministic by design — the
// script never drifts, and repeat plays cost nothing (R2-cached MP3s).
import { writable, get } from "svelte/store";
import { tick } from "svelte";
import { appView } from "./store.js";
import { api } from "./api.js";
import { TOUR_STEPS } from "./tourScript.js";

export const tourState = writable(null);
// null | { steps, idx, rect, playing, audioOk }

let audio = null;
// Generation counter: endTour bumps it, and every async continuation checks it —
// no stale showStep/auto-advance can resurrect a finished tour.
let gen = 0;

function stopAudio() {
  if (audio) { try { audio.pause(); } catch {} audio = null; }
}

async function locate(target) {
  await tick();
  // The screen may mount asynchronously — poll briefly for the target.
  for (let i = 0; i < 20; i++) {
    const el = document.querySelector(`[data-tour="${target}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 60));
  }
  return null; // no target — the caption card still shows, centered
}

async function narrate(text, onDone) {
  stopAudio();
  try {
    const token = localStorage.getItem("emblem_token") || "";
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); onDone?.(); };
    audio.onerror = () => { URL.revokeObjectURL(url); onDone?.(); };
    await audio.play();
    return true;
  } catch (e) {
    console.warn("tour narration unavailable:", e?.message || e);
    return false; // captions-only — user advances with Next
  }
}

async function showStep(idx, myGen) {
  if (myGen !== gen) return;
  const steps = TOUR_STEPS;
  if (idx >= steps.length) return endTour(true);
  const step = steps[idx];
  appView.set(step.view);
  // Advance the card IMMEDIATELY — the spotlight fills in once the target mounts.
  // (Setting state only after locate() made fast Next clicks repeat steps.)
  tourState.set({ steps, idx, rect: null, playing: false, audioOk: true });
  const rect = await locate(step.target);
  if (myGen !== gen) return;
  let s = get(tourState);
  if (!s || s.idx !== idx) return;   // user already moved on
  tourState.set({ ...s, rect });
  const ok = await narrate(step.script, () => {
    // Auto-advance a beat after the line finishes (unless the tour moved/ended).
    if (myGen !== gen) return;
    const c1 = get(tourState);
    if (c1 && c1.idx === idx) setTimeout(() => {
      if (myGen !== gen) return;
      const c2 = get(tourState); if (c2 && c2.idx === idx) next();
    }, 900);
  });
  if (myGen !== gen) return;
  s = get(tourState);
  if (s && s.idx === idx) tourState.set({ ...s, playing: ok, audioOk: ok });
}

export function startTour() {
  gen += 1;
  showStep(0, gen);
}

export function next() {
  const s = get(tourState);
  if (!s) return;
  showStep(s.idx + 1, gen);
}

export function prev() {
  const s = get(tourState);
  if (!s || s.idx === 0) return;
  showStep(s.idx - 1, gen);
}

export function endTour(completed = false) {
  gen += 1;               // invalidate every in-flight step and timer
  stopAudio();
  tourState.set(null);
  appView.set("chat");
  api.profileSet({ toured: true }).catch((e) => console.warn("toured save failed:", e));
  try { localStorage.setItem("emblem_toured", "1"); } catch {}
  void completed;
}

// Debug handle (read-only introspection in DevTools/probes).
if (typeof window !== "undefined") {
  window.__emblemTour = {
    state: () => get(tourState),
    gen: () => gen,
    end: () => endTour(false),
  };
}

// Recompute the spotlight on resize so it tracks its target.
if (typeof window !== "undefined") {
  window.addEventListener("resize", async () => {
    const s = get(tourState);
    if (!s) return;
    const rect = await locate(s.steps[s.idx].target);
    const cur = get(tourState);
    if (cur && cur.idx === s.idx) tourState.set({ ...cur, rect });
  });
}
