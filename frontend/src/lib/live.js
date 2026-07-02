// Emblem live-voice client — one WebSocket session to /api/voice/live.
// Handles mic capture (PCM 16k), streamed playback (PCM 24k), captions, and barge-in.
// Used by both the conversational onboarding and the everyday voice mode.

import { API_BASE } from "./api.js";
const CAP_RATE = 16000;
const PLAY_RATE = 24000;

export class LiveClient {
  /**
   * @param {object} opts
   *   mode        "chat" | "onboarding"
   *   onState     (state) => {}   connecting|ready|listening|thinking|speaking|onboarded|unavailable|ended
   *   onCaption   ({who, text}) => {}
   *   onLevel     (0..1) => {}    live mic level (for the orb)
   */
  constructor(opts = {}) {
    this.mode = opts.mode || "chat";
    this.onState = opts.onState || (() => {});
    this.onCaption = opts.onCaption || (() => {});
    this.onLevel = opts.onLevel || (() => {});
    this.ws = null; this.audioCtx = null; this.micStream = null;
    this.procNode = null; this.analyser = null;
    this.playHead = 0; this.sources = [];
    this.speaking = false; this.stopped = false;
  }

  _url() {
    const token = (typeof localStorage !== "undefined" && localStorage.getItem("emblem_token")) || "";
    const qs = `?mode=${this.mode}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    // Single source of truth: wherever the REST API lives, the voice socket lives too.
    const base = API_BASE || `${location.protocol}//${location.host}`;
    return base.replace(/^http/, "ws") + "/api/voice/live" + qs;
  }

  async start({ mic = true } = {}) {
    this.onState("connecting");
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      await this.audioCtx.resume();
      if (mic) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      }
    } catch {
      this.onState("unavailable");
      return false;
    }

    return new Promise((resolve) => {
      this.ws = new WebSocket(this._url());
      this.ws.binaryType = "arraybuffer";
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "audio") this._play(m.data);
        else if (m.type === "caption") this.onCaption(m);
        else if (m.type === "status") {
          if (m.state === "ready") { this.onState("listening"); if (mic) this._startMic(); resolve(true); }
          else if (m.state === "turn_complete") { this.speaking = false; this.onState("listening"); }
          else if (m.state === "interrupted") this._bargeIn();
          else if (m.state === "onboarded") this.onState("onboarded");
          else if (m.state === "unavailable") { this.onState("unavailable"); resolve(false); }
          else if (m.state === "ended") { if (!this.stopped) this.onState("ended"); }
        }
      };
      this.ws.onerror = () => { this.onState("unavailable"); resolve(false); };
      this.ws.onclose = () => { if (!this.stopped) this.onState("ended"); };
    });
  }

  sendText(text) {
    const t = (text || "").trim();
    if (t && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: "text", text: t }));
  }

  _startMic() {
    const src = this.audioCtx.createMediaStreamSource(this.micStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    src.connect(this.analyser);
    this.procNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
    src.connect(this.procNode);
    this.procNode.connect(this.audioCtx.destination);
    const levelBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.procNode.onaudioprocess = (e) => {
      // live level for the orb
      this.analyser.getByteFrequencyData(levelBuf);
      let sum = 0; for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i];
      this.onLevel(Math.min(1, sum / levelBuf.length / 90));
      if (!this.ws || this.ws.readyState !== 1) return;
      const input = e.inputBuffer.getChannelData(0);
      const ds = downsample(input, this.audioCtx.sampleRate, CAP_RATE);
      this.ws.send(floatToPCM16(ds).buffer);
    };
  }

  _play(b64) {
    if (!this.audioCtx) return;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
    const buf = this.audioCtx.createBuffer(1, f32.length, PLAY_RATE);
    buf.copyToChannel(f32, 0);
    const srcNode = this.audioCtx.createBufferSource();
    srcNode.buffer = buf; srcNode.connect(this.audioCtx.destination);
    const now = this.audioCtx.currentTime;
    if (this.playHead < now) this.playHead = now;
    srcNode.start(this.playHead);
    this.playHead += buf.duration;
    this.sources.push(srcNode);
    srcNode.onended = () => { this.sources = this.sources.filter((s) => s !== srcNode); };
    if (!this.speaking) { this.speaking = true; this.onState("speaking"); }
  }

  _bargeIn() {
    // The user cut in — stop everything queued and go back to listening.
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources = [];
    this.playHead = 0;
    this.speaking = false;
    this.onState("listening");
  }

  stop() {
    this.stopped = true;
    try { this.ws?.send(JSON.stringify({ type: "end" })); this.ws?.close(); } catch {}
    try { this.procNode?.disconnect(); } catch {}
    try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.audioCtx?.close(); } catch {}
  }
}

function floatToPCM16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsample(buffer, srcRate, dstRate) {
  if (srcRate === dstRate) return buffer;
  const ratio = srcRate / dstRate;
  const len = Math.round(buffer.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio), end = Math.floor((i + 1) * ratio);
    let sum = 0, n = 0;
    for (let j = start; j < end && j < buffer.length; j++) { sum += buffer[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}
