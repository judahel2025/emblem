// Offline voice capture: record the mic locally (WebM/Opus, no internet, no Google),
// detect speech start/stop via Web-Audio level (VAD), and hand each utterance to the
// caller for whisper transcription. Plays TTS back with barge-in. Reports every step
// through onDiag so problems are visible, not silent.

export class VoiceSession {
  constructor({ onState, onDiag, onUtterance }) {
    this.onState = onState || (() => {});
    this.onDiag = onDiag || (() => {});
    this.onUtterance = onUtterance; // async (blob) => audioUrl | null
    this.live = false;
    this.stream = null; this.ctx = null; this.analyser = null; this.data = null; this.audioEl = null;
  }

  async start() {
    this.onDiag("requesting microphone…");
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") { try { await this.ctx.resume(); } catch {} }
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.data = new Uint8Array(this.analyser.fftSize);
    src.connect(this.analyser);
    this.live = true;
    await this._calibrate();
    this._loop();
  }

  // Sample the room's noise floor so the speech threshold adapts to THIS mic
  // (quiet mics, heavy noise-suppression, or a noisy room all "just work").
  async _calibrate() {
    this.onDiag("calibrating mic…");
    let sum = 0, n = 0;
    const t0 = performance.now();
    while (this.live && performance.now() - t0 < 500) {
      await this._sleep(40);
      sum += this._rms();
      n++;
    }
    const floor = n ? sum / n : 0;
    // a touch above ambient, but never so low we trigger on hiss nor so high we miss speech
    this.thresh = Math.min(0.045, Math.max(0.008, floor * 1.8 + 0.006));
    this.onDiag("ready — say something");
  }

  stop() {
    this.live = false;
    if (this.audioEl) { this.audioEl.pause(); this.audioEl = null; }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) { try { this.ctx.close(); } catch {} }
    this.stream = this.ctx = this.analyser = null;
    this.onState("idle");
  }

  _rms() {
    this.analyser.getByteTimeDomainData(this.data);
    let s = 0;
    for (let i = 0; i < this.data.length; i++) { const v = (this.data[i] - 128) / 128; s += v * v; }
    return Math.sqrt(s / this.data.length);
  }
  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  _mime() {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
    return "";
  }

  async _loop() {
    while (this.live) {
      this.onState("listening");
      const blob = await this._record();
      if (!this.live) break;
      if (!blob) continue;
      this.onState("thinking"); this.onDiag("transcribing…");
      let url = null;
      try { url = await this.onUtterance(blob); } catch { url = null; }
      if (!this.live) break;
      if (url) { this.onState("speaking"); await this._play(url); }
      else { this.onDiag("(didn't catch words — keep talking)"); }
    }
  }

  async _record() {
    const THRESH = this.thresh || 0.012, SILENCE_MS = 850, MAX_MS = 14000;
    const mime = this._mime();
    const rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    rec.start(120);
    let started = false, lastVoice = 0, t0 = performance.now(), idleSaid = false;
    this.onDiag("listening — say something");
    while (this.live) {
      await this._sleep(60);
      const rms = this._rms();
      const now = performance.now();
      if (rms > THRESH) { if (!started) this.onDiag("hearing you…"); started = true; lastVoice = now; }
      if (started && now - lastVoice > SILENCE_MS) break;
      if (started && now - t0 > MAX_MS) break;
      if (!started && now - t0 > 8000 && !idleSaid) { this.onDiag("listening… (speak up)"); idleSaid = true; }
    }
    try { rec.stop(); } catch {}
    await this._sleep(150);
    if (!started || !chunks.length) return null;
    return new Blob(chunks, { type: mime || "audio/webm" });
  }

  async _play(url) {
    const el = new Audio(url);
    this.audioEl = el;
    el.play().catch(() => {});
    const THRESH = 0.03;
    let voice = 0;
    while (this.live && !el.ended && !el.paused) {
      await this._sleep(70);
      voice = this._rms() > THRESH ? voice + 1 : 0;
      if (voice >= 3) { el.pause(); this.onDiag("you cut in — listening"); break; }
    }
    this.audioEl = null;
  }
}
