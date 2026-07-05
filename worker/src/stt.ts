// Speech-to-text for the turn-based voice pipeline.
// Primary: Groq Whisper (whisper-large-v3-turbo — fast, generous free tier).
// Fallback: Gemini generateContent with inline audio. Never throws — the voice
// loop must always be able to say "didn't catch that" and keep listening.

import type { Env } from "./env";

export type SttResult =
  | { ok: true; text: string; via: "groq" | "gemini" }
  | { ok: false; error: string };

async function groqTranscribe(env: Env, file: File): Promise<SttResult> {
  if (!env.GROQ_KEY) return { ok: false, error: "no groq key" };
  const fd = new FormData();
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("file", file, file.name || "clip.webm");
  fd.append("response_format", "json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_KEY}` },
    body: fd,
  });
  if (!res.ok) return { ok: false, error: `groq ${res.status}` };
  const d = await res.json<{ text?: string }>().catch(() => ({} as { text?: string }));
  const text = (d.text || "").trim();
  if (!text) return { ok: false, error: "empty transcript" };
  return { ok: true, text, via: "groq" };
}

async function geminiTranscribe(env: Env, file: File): Promise<SttResult> {
  if (!env.GEMINI_KEY) return { ok: false, error: "no gemini key" };
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: file.type || "audio/webm", data: btoa(bin) } },
          { text: "Transcribe this audio verbatim. Reply with only the transcript, nothing else. If there is no speech, reply with an empty string." },
        ] }],
        generationConfig: { temperature: 0 },
      }),
    });
  if (!res.ok) return { ok: false, error: `gemini ${res.status}` };
  const d = await res.json<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>()
    .catch(() => ({} as { candidates?: [] }));
  const text = (d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "").trim();
  if (!text) return { ok: false, error: "empty transcript" };
  return { ok: true, text, via: "gemini" };
}

export async function transcribe(env: Env, file: File): Promise<SttResult> {
  try {
    const g = await groqTranscribe(env, file).catch((e) =>
      ({ ok: false as const, error: e instanceof Error ? e.message : "groq failed" }));
    if (g.ok) return g;
    const f = await geminiTranscribe(env, file).catch((e) =>
      ({ ok: false as const, error: e instanceof Error ? e.message : "gemini failed" }));
    if (f.ok) return f;
    return { ok: false, error: `${g.error}; ${f.error}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "transcription failed" };
  }
}
