// The brain pool — ONE ordered provider chain for every text-generation need
// (agent loop, onboarding interviewer, titles, suggestions, extraction).
// Strategy: Cerebras (fastest) → Groq → Gemini generateContent. Each provider
// gets a retry on 429/5xx, then the chain falls through — three keys means no
// single point of failure. Provider-blind to clients, as always.

import type { Env } from "./env";

export interface ChatMsg {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface OpenAIToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface PoolResult {
  content: string;
  tool_calls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  raw: ChatMsg;
}

interface PoolOpts {
  tools?: OpenAIToolDef[];
  maxTokens?: number;
  temperature?: number;
  /** force JSON-object output where the provider supports it */
  json?: boolean;
}

async function openAICompatible(url: string, key: string, model: string,
    messages: ChatMsg[], opts: PoolOpts): Promise<PoolResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body: Record<string, unknown> = {
        model, messages, max_tokens: opts.maxTokens ?? 2400,
      };
      if (opts.temperature !== undefined) body.temperature = opts.temperature;
      if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = "auto"; }
      if (opts.json) body.response_format = { type: "json_object" };
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;   // request-shape rejection — next provider
      const data = await res.json<{ choices?: Array<{ message: ChatMsg }> }>();
      const msg = data.choices?.[0]?.message;
      if (!msg) return null;
      return {
        content: msg.content || "",
        tool_calls: (msg.tool_calls || []).map((tc) => ({
          id: tc.id, name: tc.function.name,
          args: (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })(),
        })),
        raw: msg,
      };
    } catch { /* network — retry then fall through */ }
  }
  return null;
}

/** Gemini generateContent as the last text fallback (no tool-calling here). */
async function geminiText(env: Env, messages: ChatMsg[], opts: PoolOpts): Promise<PoolResult | null> {
  if (!env.GEMINI_KEY || opts.tools?.length) return null;
  try {
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages.filter((m) => m.role === "user" || m.role === "assistant");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: sys ? { parts: [{ text: sys }] } : undefined,
          contents: turns.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content || "" }],
          })),
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 2400,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
    if (!res.ok) return null;
    const data = await res.json<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) return null;
    return { content: text, tool_calls: [], raw: { role: "assistant", content: text } };
  } catch { return null; }
}

/** Ask the pool. Falls through Cerebras → Groq → Gemini; null only if ALL fail. */
export async function poolChat(env: Env, messages: ChatMsg[], opts: PoolOpts = {}):
    Promise<PoolResult | null> {
  const providers: Array<() => Promise<PoolResult | null>> = [];
  if (env.CEREBRAS_KEY) providers.push(() =>
    openAICompatible("https://api.cerebras.ai/v1/chat/completions", env.CEREBRAS_KEY!, "gpt-oss-120b", messages, opts));
  if (env.GROQ_KEY) providers.push(() =>
    openAICompatible("https://api.groq.com/openai/v1/chat/completions", env.GROQ_KEY!, "llama-3.3-70b-versatile", messages, opts));
  providers.push(() => geminiText(env, messages, opts));

  for (const p of providers) {
    const r = await p();
    if (r) return r;
  }
  return null;
}
