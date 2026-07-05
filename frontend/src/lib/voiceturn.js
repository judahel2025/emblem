// VoiceTurnClient — the turn-based, hands-free voice pipeline that replaced the
// realtime relay: mic + silence detection → one recorded utterance → STT
// (/api/voice/transcribe: Groq Whisper, Gemini fallback) → the caller's brain
// (onTranscript returns the reply text) → spoken reply via /api/voice/tts →
// listen again. Emits the SAME events/states as LiveClient (onState, onCaption,
// onLevel, onError; connecting/listening/thinking/speaking/unavailable/error)
// so VoiceLive.svelte and Onboarding.svelte shells work unchanged.
//
// VAD tuning lives here — one place to tweak after real-world testing.
const SILENCE_MS = 1400;        // this much quiet after speech ends the utterance
const MIN_SPEECH_MS = 250;      // shorter blips are noise, not speech
const MAX_UTTERANCE_MS = 30000; // force-stop marathon clips (keeps uploads small)
const IDLE_RESTART_MS = 20000;  // no speech at all → restart recorder, drop the silence
const BARGE_MS = 350;           // sustained loud input while speaking → barge-in pause
const TICK_MS = 50;

import { api } from "./api.js";

export class VoiceTurnClient {
  constructor({ mode = "chat", onTranscript, onState, onCaption, onLevel, onError } = {}) {
    this.mode = mode;
    this.onTranscript = onTranscript || (async () => null);
    this.onState = onState || (() => {});
    this.onCaption = onCaption || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onError = onError || (() => {});

    this._state = "idle";
    this._stopped = false;
    this._muted = false;
    this._suspended = false;
    this._pendingAudio = null;   // audio element waiting on an autoplay unlock

    this._stream = null;
    this._ctx = null;
    this._analyser = null;
    this._recorder = null;
    this._chunks = [];
    this._mime = "";
    this._timer = null;
    this._audio = null;

    // VAD bookkeeping
    this._threshold = 0.012;
    this._calibrating = 0;       // samples remaining in the ambient-calibration window
    this._ambient = [];
    this._speechMs = 0;
    this._silenceMs = 0;
    this._hadSpeech = false;
    this._utterMs = 0;
    this._idleMs = 0;
    this._bargeMs = 0;

    // The "audioCtx" LiveClient exposed — screens call client.audioCtx?.resume()
    // from their tap-to-enable button, so keep that exact shape.
    this.audioCtx = { resume: async () => this._resumeAudio() };
  }

  _set(state) {
    if (this._stopped) return;
    this._state = state;
    this.onState(state);
  }

  async start({ mic = true } = {}) {
    this._set("connecting");
    if (!mic || typeof MediaRecorder === "undefined") {
      // No mic (or unsupported browser): typed input still works via sendText.
      if (typeof MediaRecorder === "undefined") this.onError("Voice input isn't supported in this browser.");
      this._set(mic ? "unavailable" : "listening");
      return !mic;
    }
    this._mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      .find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
    if (!this._mime) {
      this.onError("No supported audio recorder found.");
      this._set("unavailable");
      return false;
    }
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.onError("Microphone access was denied.");
      this._set("unavailable");
      return false;
    }
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this._ctx.createMediaStreamSource(this._stream);
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 1024;
      src.connect(this._analyser);
    } catch {
      this.onError("Couldn't open the audio pipeline.");
      this._teardownMedia();
      this._set("unavailable");
      return false;
    }
    this._calibrating = Math.round(600 / TICK_MS);
    this._ambient = [];
    this._startListening();
    this._timer = setInterval(() => this._tick(), TICK_MS);
    return true;
  }

  // ── the VAD/state loop ─────────────────────────────────────────────
  _rms() {
    if (!this._analyser) return 0;
    const buf = new Float32Array(this._analyser.fftSize);
    try { this._analyser.getFloatTimeDomainData(buf); }
    catch {
      const b = new Uint8Array(this._analyser.fftSize);
      this._analyser.getByteTimeDomainData(b);
      for (let i = 0; i < b.length; i++) buf[i] = (b[i] - 128) / 128;
    }
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  _tick() {
    if (this._stopped) return;
    const rms = this._rms();
    this.onLevel(Math.min(rms * 9, 1));

    if (this._calibrating > 0) {
      this._ambient.push(rms);
      this._calibrating--;
      if (this._calibrating === 0) {
        const avg = this._ambient.reduce((a, b) => a + b, 0) / (this._ambient.length || 1);
        this._threshold = Math.max(avg * 2.5, 0.012);
      }
      return;
    }

    if (this._state === "listening" && !this._muted) {
      const loud = rms > this._threshold;
      this._utterMs += TICK_MS;
      if (loud) { this._speechMs += TICK_MS; this._silenceMs = 0; this._idleMs = 0; }
      else { this._silenceMs += TICK_MS; if (!this._hadSpeech) this._idleMs += TICK_MS; }
      if (!this._hadSpeech && this._speechMs >= MIN_SPEECH_MS) {
        this._hadSpeech = true;
      }
      if (this._hadSpeech &&
          (this._silenceMs >= SILENCE_MS || this._utterMs >= MAX_UTTERANCE_MS)) {
        this._finishUtterance();
      } else if (!this._hadSpeech && this._idleMs >= IDLE_RESTART_MS) {
        // Nothing said for a while — restart the recorder so silence doesn't pile up.
        this._restartRecorder();
      }
    } else if (this._state === "speaking" && !this._muted) {
      // Barge-in: sustained voice while Emblem talks pauses the reply.
      if (rms > this._threshold * 1.6) {
        this._bargeMs += TICK_MS;
        if (this._bargeMs >= BARGE_MS) {
          this._bargeMs = 0;
          try { this._audio?.pause(); } catch {}
          this._speechQueue = [];
          this._startListening();
        }
      } else {
        this._bargeMs = 0;
      }
    }
  }

  _startListening() {
    if (this._stopped) return;
    this._hadSpeech = false;
    this._speechMs = 0;
    this._silenceMs = 0;
    this._utterMs = 0;
    this._idleMs = 0;
    this._restartRecorder();
    this._set("listening");
  }

  _restartRecorder() {
    if (!this._stream || this._stopped) return;
    try { if (this._recorder && this._recorder.state !== "inactive") { this._recorder.ondataavailable = null; this._recorder.onstop = null; this._recorder.stop(); } } catch {}
    this._chunks = [];
    this._idleMs = 0;
    try {
      this._recorder = new MediaRecorder(this._stream, { mimeType: this._mime });
      this._recorder.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };
      this._recorder.start();
    } catch {
      this.onError("Recorder failed — voice paused.");
      this._set("unavailable");
    }
  }

  _finishUtterance() {
    if (!this._recorder || this._recorder.state === "inactive") { this._startListening(); return; }
    this._set("thinking");
    const rec = this._recorder;
    rec.onstop = async () => {
      const blob = new Blob(this._chunks, { type: this._mime });
      this._chunks = [];
      if (!blob.size) { this._startListening(); return; }
      let text = "";
      try {
        const r = await api.transcribe(blob, this._mime);
        if (r?.ok && r.text?.trim()) text = r.text.trim();
        else if (r?.error) console.warn("stt:", r.error);
      } catch (e) { console.warn("transcribe failed:", e); }
      if (this._stopped) return;
      if (!text) {
        // Didn't catch it — no dead ends, just keep listening.
        this.onError("Didn't catch that — try again.");
        this._startListening();
        return;
      }
      this.onCaption({ who: "user", text });
      await this._runTurn(text);
    };
    try { rec.stop(); } catch { this._startListening(); }
  }

  async _runTurn(text) {
    this._set("thinking");
    let reply = null;
    try { reply = await this.onTranscript(text); }
    catch (e) { console.error("voice turn brain failed:", e); this.onError("Something went wrong — say that again?"); }
    if (this._stopped) return;
    if (!reply) { this._startListening(); return; }
    this.onCaption({ who: "assistant", text: reply });
    await this._speak(reply);
    if (!this._stopped && this._state !== "listening") this._startListening();
  }

  // Typed input joins the same loop (skips STT). Mirrors LiveClient.sendText.
  sendText(text) {
    const t = (text || "").trim();
    if (!t || this._stopped) return;
    if (this._state === "speaking") { try { this._audio?.pause(); } catch {} this._speechQueue = []; }
    this._runTurn(t);
  }

  // ── speech out — chunked TTS, sequential playback ──────────────────
  async _speak(text) {
    this._set("speaking");
    this._speechQueue = this._chunkText(text);
    while (this._speechQueue.length && !this._stopped) {
      const chunk = this._speechQueue.shift();
      let url = null;
      try { url = await api.speechUrl(chunk); } catch {}
      if (!url) break;                      // TTS down — captions already carry it
      const done = await this._playUrl(url);
      if (!done) break;                     // paused (barge-in) or blocked
    }
  }

  _chunkText(text) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= 1100) return clean ? [clean] : [];
    const parts = [];
    let rest = clean;
    while (rest.length > 1100) {
      let cut = rest.lastIndexOf(". ", 1100);
      if (cut < 400) cut = rest.lastIndexOf(" ", 1100);
      if (cut < 1) cut = 1100;
      parts.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  _playUrl(url) {
    return new Promise((resolve) => {
      try { this._audio?.pause(); } catch {}
      const a = new Audio(url);
      this._audio = a;
      a.onended = () => resolve(true);
      a.onerror = () => resolve(true);      // skip a bad chunk, keep going
      a.onpause = () => { if (!a.ended) resolve(false); };
      a.play().catch(() => {
        // Autoplay blocked — remember it so the tap-to-enable button can retry.
        this._suspended = true;
        this._pendingAudio = a;
        resolve(false);
      });
    });
  }

  async _resumeAudio() {
    this._suspended = false;
    const a = this._pendingAudio;
    this._pendingAudio = null;
    if (a) { try { await a.play(); } catch { this._suspended = true; } }
    try { await this._ctx?.resume(); } catch {}
  }

  audioSuspended() { return this._suspended; }

  setMuted(on) {
    this._muted = Boolean(on);
    if (this._muted) {
      // Discard any half-captured utterance; the orb goes quiet.
      this._hadSpeech = false; this._speechMs = 0; this._silenceMs = 0;
      this._restartRecorder();
      this.onLevel(0);
    }
  }

  _teardownMedia() {
    try { this._recorder && this._recorder.state !== "inactive" && this._recorder.stop(); } catch {}
    this._recorder = null;
    try { this._stream?.getTracks().forEach((t) => t.stop()); } catch {}
    this._stream = null;
    try { this._ctx?.close(); } catch {}
    this._ctx = null;
    this._analyser = null;
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    clearInterval(this._timer);
    this._timer = null;
    try { this._audio?.pause(); } catch {}
    this._audio = null;
    this._pendingAudio = null;
    this._speechQueue = [];
    this._teardownMedia();
  }
}
