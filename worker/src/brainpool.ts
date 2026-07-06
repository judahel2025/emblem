// The brain pool — ONE ordered provider chain for every text-generation need
// (agent loop, onboarding interviewer, titles, suggestions, extraction).
// Strategy: Cerebras (fastest) → Groq → Gemini generateContent. Each provider
// gets a retry on 429/5xx, then the chain falls through — four keys (two
// Gemini) means no single point of failure. Gemini is a REAL last resort even
// when tools are requested: it converts the OpenAI-shaped tool defs to
// Gemini's function-calling schema and parses functionCall parts back into
// the same tool_calls shape, so a Cerebras+Groq outage no longer dead-ends
// the agent loop with "I'm having trouble thinking." Provider-blind to
// clients, as always.

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

// ---- Gemini schema conversion — OpenAI JSON Schema → Gemini's uppercase Type enum ----

function toGeminiSchema(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };
  if (typeof n.type === "string") out.type = n.type.toUpperCase();
  if (n.properties && typeof n.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) props[k] = toGeminiSchema(v);
    out.properties = props;
  }
  if (n.items) out.items = toGeminiSchema(n.items);
  return out;
}

function toGeminiTools(tools: OpenAIToolDef[]): Record<string, unknown> {
  return {
    function_declarations: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: toGeminiSchema(t.function.parameters),
    })),
  };
}

/** Gemini generateContent — a REAL fallback, tool-calling included. Tries
 *  GEMINI_KEY then GEMINI_KEY2 on 429/5xx/network so one exhausted key
 *  doesn't take the whole pool down with it. */
async function geminiText(env: Env, messages: ChatMsg[], opts: PoolOpts): Promise<PoolResult | null> {
  const keys = [env.GEMINI_KEY, env.GEMINI_KEY2].filter((k): k is string => Boolean(k));
  if (!keys.length) return null;

  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  // Gemini's generateContent turns are user/model only — fold any tool results
  // back in as plain user-role context so a Cerebras/Groq tool loop can still
  // be picked up mid-flight by this fallback.
  const turns = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool");
  const contents = turns.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.role === "tool" ? `[tool result] ${m.content || ""}` : (m.content || "") }],
  }));

  for (const key of keys) {
    try {
      const body: Record<string, unknown> = {
        system_instruction: sys ? { parts: [{ text: sys }] } : undefined,
        contents,
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 2400,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      };
      if (opts.tools?.length) body.tools = [toGeminiTools(opts.tools)];
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) continue;   // try the next key
      if (!res.ok) return null;
      const data = await res.json<{ candidates?: Array<{ content?: { parts?: Array<{
        text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> } }> }>();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || "").join("");
      const calls = parts.filter((p) => p.functionCall).map((p, i) => ({
        id: `gemini-call-${i}`, name: p.functionCall!.name, args: p.functionCall!.args || {},
      }));
      if (!text && !calls.length) return null;
      return {
        content: text,
        tool_calls: calls,
        raw: { role: "assistant", content: text || null,
          tool_calls: calls.map((c) => ({ id: c.id, function: { name: c.name, arguments: JSON.stringify(c.args) } })) },
      };
    } catch { /* network — try the next key */ }
  }
  return null;
}

/** Ask the pool. Falls through Cerebras → Groq → Gemini (2 keys); null only if ALL fail. */
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
