// One-shot TTS for scripted narration (the product tour) and spoken replies.
// Uses Gemini's native TTS on generativelanguage.googleapis.com, the SAME key
// that powers live voice (an AI Studio key does NOT work with Google Cloud TTS;
// that combination 401s). Gemini TTS returns raw PCM (s16le, 24 kHz mono), which
// browsers can't play directly, so we wrap it in a WAV header. Cached in R2 by
// content hash, each tour line costs one synthesis EVER.
// Provider-blind to the client: the route returns bare audio/wav.

import type { Env } from "./env";

const MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Zephyr";   // matches the live-voice persona
const SAMPLE_RATE = 24000;

async function cacheKey(voice: string, text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(`${MODEL}|${voice}|${text}`));
  const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `tts/${hex}.wav`;
}

/** Wrap raw PCM s16le mono in a RIFF/WAV header so <audio> can play it. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);          // fmt chunk size
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);  // byte rate (16-bit mono)
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  writeStr(36, "data");
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export async function synthesize(env: Env, text: string, voice = DEFAULT_VOICE):
    Promise<Response> {
  const clean = (text || "").trim().slice(0, 1200);
  if (!clean) return new Response("text required", { status: 400 });
  if (!env.GEMINI_KEY) return new Response("unavailable", { status: 503 });

  const key = await cacheKey(voice, clean);
  const cached = await env.FILES.get(key);
  if (cached) {
    return new Response(cached.body, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
    });
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: clean }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
  if (!r.ok) {
    console.error("tts upstream", r.status, (await r.text()).slice(0, 300));
    return new Response("unavailable", { status: 503 });
  }
  const data = await r.json<{
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  }>();
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) return new Response("unavailable", { status: 503 });

  const pcm = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const wav = pcmToWav(pcm, SAMPLE_RATE);
  await env.FILES.put(key, wav, { httpMetadata: { contentType: "audio/wav" } });
  return new Response(wav, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
  });
}
