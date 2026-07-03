// VoiceRelay — a Durable Object that bridges the browser WebSocket to Gemini Live.
//
// A plain Worker can't keep an OUTBOUND WebSocket (to Gemini) alive after its fetch
// handler returns, so audio never pumps. A Durable Object instance stays alive as long
// as its sockets are open, which is exactly what a realtime relay needs. Each voice
// session gets its own short-lived DO instance.
//
// The client sees only generic frames ({type: audio|caption|status}) — never the provider.

import type { Env } from "./env";
import { userFromToken } from "./auth";

const HOST = "generativelanguage.googleapis.com";
const MODEL = "models/gemini-3.1-flash-live-preview";
const VOICE = "Zephyr";

const PERSONA_CHAT =
  "You are Emblem — the user's warm, concise, decisive voice assistant. Keep replies " +
  "short and spoken-natural. Never reveal which AI, model, or provider powers you.";

const PERSONA_ONBOARDING =
  "You are Emblem, meeting a brand-new member for the very first time — and YOU speak first. " +
  "Open warmly: introduce yourself in one short sentence and ask their name. Then, ONE question " +
  "at a time, learn: what they do, what they most want help with day to day, and how they like " +
  "to be spoken to (brief and direct, or warm and chatty). Keep every turn short and natural — " +
  "this is a conversation, not a form. React to what they say. When you have all four answers, " +
  "thank them by name, tell them you're ready, and call save_profile with what you learned. " +
  "Never reveal which AI, model, or provider powers you.";

const SAVE_PROFILE_TOOL = {
  function_declarations: [{
    name: "save_profile",
    description: "Save what you learned about the new member once the conversation is complete.",
    parameters: {
      type: "OBJECT",
      properties: {
        display_name: { type: "STRING", description: "what to call them" },
        role: { type: "STRING", description: "what they do" },
        focus: { type: "STRING", description: "what they most want help with" },
        tone: { type: "STRING", description: "how they like to be spoken to" },
      },
      required: ["display_name"],
    },
  }],
};

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export class VoiceRelay {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "onboarding" ? "onboarding" : "chat";
    const userId = await userFromToken(url.searchParams.get("token") || "", this.env);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    const send = (o: unknown) => { try { server.send(JSON.stringify(o)); } catch { /* closed */ } };
    const denyReturn = (state: string) => {
      send({ type: "status", state }); try { server.close(); } catch { /* closed */ }
      return new Response(null, { status: 101, webSocket: client });
    };

    if (!userId || !this.env.GEMINI_KEY) return denyReturn("unavailable");

    // Standard client constructor — the supported way to hold a long-lived
    // OUTBOUND socket from the Workers runtime (fetch-Upgrade sockets get torn
    // down with the request context; these don't).
    let upstream: WebSocket | null = null;
    try {
      upstream = new WebSocket(
        `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.env.GEMINI_KEY}`);
      // Gemini Live sends BINARY frames. The constructor socket defaults to
      // binaryType "blob", which TextDecoder can't read — every frame (incl.
      // setupComplete) then throws and gets dropped, so "ready" never fires.
      try { (upstream as any).binaryType = "arraybuffer"; } catch { /* older runtime */ }
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("upstream open timeout")), 12000);
        upstream!.addEventListener("open", () => { clearTimeout(to); resolve(); });
        upstream!.addEventListener("error", () => { clearTimeout(to); reject(new Error("upstream error")); });
      });
    } catch { upstream = null; }
    if (!upstream) return denyReturn("unavailable");
    const up = upstream;

    const setup: Record<string, unknown> = {
      model: MODEL,
      generation_config: {
        response_modalities: ["AUDIO"],
        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: VOICE } } },
      },
      system_instruction: { parts: [{ text: mode === "onboarding" ? PERSONA_ONBOARDING : PERSONA_CHAT }] },
    };
    if (mode === "onboarding") setup.tools = [SAVE_PROFILE_TOOL];
    up.send(JSON.stringify({ setup }));

    let ready = false;

    up.addEventListener("message", (ev) => {
      void (async () => {
        try {
          const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
          const frame = JSON.parse(raw) as Record<string, any>;

          if (frame.setupComplete !== undefined && !ready) {
            ready = true;
            send({ type: "status", state: "ready" });
            if (mode === "onboarding") {
              up.send(JSON.stringify({ client_content: {
                turns: [{ role: "user", parts: [{ text: "(the new member just arrived — greet them and begin)" }] }],
                turn_complete: true } }));
            }
            return;
          }
          const sc = frame.serverContent || {};
          for (const p of sc.modelTurn?.parts || []) {
            const inline = p.inlineData || p.inline_data;
            if (inline?.data) send({ type: "audio", data: inline.data });
          }
          if (sc.outputTranscription?.text) send({ type: "caption", who: "assistant", text: sc.outputTranscription.text });
          if (sc.inputTranscription?.text) send({ type: "caption", who: "user", text: sc.inputTranscription.text });
          if (sc.interrupted) send({ type: "status", state: "interrupted" });
          if (sc.turnComplete) send({ type: "status", state: "turn_complete" });

          if (frame.toolCall?.functionCalls?.length) {
            for (const fc of frame.toolCall.functionCalls) {
              if (fc.name === "save_profile") {
                await this.saveProfile(userId, fc.args || {});
                up.send(JSON.stringify({ tool_response: {
                  function_responses: [{ id: fc.id, name: fc.name, response: { ok: true } }] } }));
                send({ type: "status", state: "onboarded" });
              }
            }
          }
        } catch (e) { console.error("voice: upstream frame error", e); }
      })();
    });

    up.addEventListener("close", () => { send({ type: "status", state: "ended" }); try { server.close(); } catch { /* closed */ } });
    up.addEventListener("error", () => { send({ type: "status", state: "ended" }); try { server.close(); } catch { /* closed */ } });

    server.addEventListener("message", (ev) => {
      try {
        if (typeof ev.data !== "string") {
          up.send(JSON.stringify({ realtime_input: { media_chunks: [
            { mime_type: "audio/pcm;rate=16000", data: b64encode(ev.data as ArrayBuffer) }] } }));
          return;
        }
        const msg = JSON.parse(ev.data);
        if (msg.type === "end") { try { up.close(); } catch { /* closed */ } try { server.close(); } catch { /* closed */ } }
        else if (msg.type === "text" && msg.text) {
          up.send(JSON.stringify({ client_content: {
            turns: [{ role: "user", parts: [{ text: String(msg.text) }] }], turn_complete: true } }));
        }
      } catch { /* ignore */ }
    });
    server.addEventListener("close", () => { try { up.close(); } catch { /* closed */ } });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async saveProfile(userId: string, a: Record<string, unknown>) {
    await this.env.DB.prepare(
      `INSERT INTO profiles (user_id, display_name, role, tone, onboarded)
       VALUES (?1, COALESCE(?2, ''), COALESCE(?3, ''),
               COALESCE(?4, 'warm, concise, decisive'), 1)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name = COALESCE(?2, display_name), role = COALESCE(?3, role),
         tone = COALESCE(?4, tone), onboarded = 1`)
      .bind(userId, a.display_name ?? null, a.role ?? null, a.tone ?? null).run();
    const facts: string[] = [];
    if (a.display_name) facts.push(`The user's name is ${a.display_name}.`);
    if (a.role) facts.push(`What the user does: ${a.role}.`);
    if (a.focus) facts.push(`What the user most wants help with: ${a.focus}.`);
    if (a.tone) facts.push(`How the user likes to be spoken to: ${a.tone}.`);
    for (const f of facts) {
      await this.env.DB.prepare(
        "INSERT INTO memory (kind, content, source, user_id) VALUES ('identity', ?, 'onboarding', ?)")
        .bind(f, userId).run();
    }
  }
}
