// The security kernel, faithful TS port of the Python kernel's guarantees:
//   • every tool call passes ONE choke point (executeTool)
//   • tiers: SAFE (runs) / CAUTION (runs, logged) / DANGER (needs approval) / FORBIDDEN
//   • approvals are SINGLE-USE and ARG-BOUND: approving runs exactly the arguments
//     that were requested, exactly once, nothing can swap them after the fact
//   • append-only audit of every call
//   • kill switch stops all agent/tool activity instantly
//   • full-auto mode only auto-approves an explicit allowlist

import type { Env } from "./env";

export type Tier = "safe" | "caution" | "danger" | "forbidden";

export interface ToolSpec {
  name: string;
  tier: Tier;
  description: string;
  /** one-line human summary of a call, shown on approval cards */
  summarize?: (args: Record<string, unknown>) => string;
  handler: (args: Record<string, unknown>, env: Env, userId: string) => Promise<unknown>;
}

const REGISTRY = new Map<string, ToolSpec>();

export function registerTool(spec: ToolSpec) {
  if (REGISTRY.has(spec.name)) throw new Error(`tool '${spec.name}' already registered`);
  REGISTRY.set(spec.name, spec);
}

export function toolManifest() {
  return [...REGISTRY.values()].map((t) => ({
    name: t.name, tier: t.tier, description: t.description,
  }));
}

// Tools full-auto mode may run without a click. Allowlist, omission = ask.
// Deliberately narrow: connected-app writes (composio.act) and email always ask, // auto-sending mail or auto-pushing commits would contradict the approval contract.
const FULL_AUTO_ALLOW = new Set(["files.delete"]);

// Secret-looking arg values never reach the audit log.
const SECRET_KEYS = ["password", "secret", "token", "api_key", "apikey", "key", "authorization"];
function redact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) out[k] = "***redacted***";
    else if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + `…(+${v.length - 500})`;
    else out[k] = v;
  }
  return out;
}

async function argHash(args: Record<string, unknown>): Promise<string> {
  const canon = JSON.stringify(args, Object.keys(args || {}).sort());
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- config (kill switch, approval mode) ------------------------------------

export async function getConfig(env: Env, key: string, dflt = ""): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM kernel_config WHERE key = ?")
    .bind(key).first<{ value: string }>();
  return row?.value ?? dflt;
}

export async function setConfig(env: Env, key: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO kernel_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value).run();
}

export const killSwitchOn = (env: Env) => getConfig(env, "kill_switch", "0").then((v) => v === "1");
export const approvalMode = (env: Env) => getConfig(env, "approval_mode", "ask");

// ---- audit -------------------------------------------------------------------

export async function audit(env: Env, userId: string, actor: string, tool: string,
                            tier: string, args: Record<string, unknown>,
                            status: string, result = "", approvalId?: number) {
  await env.DB.prepare(
    "INSERT INTO kernel_audit (actor, tool, tier, args_json, status, result, approval_id, user_id) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(actor, tool, tier, JSON.stringify(redact(args)), status,
          result.slice(0, 2000), approvalId ?? null, userId).run();
}

// ---- the choke point ----------------------------------------------------------

export class ApprovalRequired extends Error {
  constructor(public approvalId: number, public summary: string) { super("approval required"); }
}
export class ApprovalRejected extends Error {
  constructor(public approvalId: number) { super("approval rejected"); }
}

export async function executeTool(env: Env, userId: string, name: string,
                                  args: Record<string, unknown>, actor = "agent",
                                  approvalId?: number): Promise<unknown> {
  const spec = REGISTRY.get(name);
  if (!spec) throw new Error(`No tool named '${name}'.`);

  if (await killSwitchOn(env)) {
    await audit(env, userId, actor, name, spec.tier, args, "blocked", "kill switch on");
    throw new Error("The kill switch is on, all actions are paused.");
  }
  if (spec.tier === "forbidden") {
    await audit(env, userId, actor, name, spec.tier, args, "blocked", "forbidden tier");
    throw new Error(`'${name}' is disabled.`);
  }

  if (spec.tier === "danger") {
    const hash = await argHash(args);

    if (approvalId) {
      // Resuming a decided approval: verify it's approved, unused, and arg-bound.
      const row = await env.DB.prepare(
        "SELECT id, status, args_json FROM kernel_approvals WHERE id = ? AND user_id = ?")
        .bind(approvalId, userId).first<{ id: number; status: string; args_json: string }>();
      if (!row || row.status !== "approved") throw new ApprovalRejected(approvalId);
      const bound = await argHash(JSON.parse(row.args_json));
      if (bound !== hash) {
        await audit(env, userId, actor, name, spec.tier, args, "blocked", "args differ from approval");
        throw new Error("Arguments don't match the approved action.");
      }
      // Burn it, single use.
      await env.DB.prepare("UPDATE kernel_approvals SET status = 'used' WHERE id = ?")
        .bind(approvalId).run();
    } else {
      const auto = (await approvalMode(env)) === "auto" && FULL_AUTO_ALLOW.has(name);
      if (!auto) {
        const summary = spec.summarize?.(args) ?? spec.description;
        // Dedupe: if the model re-emits the SAME action (tool + identical args)
        // while a card for it is already pending, reuse that card instead of
        // stacking a new one every turn.
        const pending = await env.DB.prepare(
          "SELECT id, args_json FROM kernel_approvals WHERE user_id = ? AND tool = ? AND status = 'pending'")
          .bind(userId, name).all<{ id: number; args_json: string }>();
        for (const p of pending.results || []) {
          try { if (await argHash(JSON.parse(p.args_json)) === hash) throw new ApprovalRequired(p.id, summary); }
          catch (e) { if (e instanceof ApprovalRequired) throw e; }
        }
        const r = await env.DB.prepare(
          "INSERT INTO kernel_approvals (tool, summary, args_json, risk, status, requested_by, user_id) " +
          "VALUES (?, ?, ?, 'high', 'pending', ?, ?)")
          .bind(name, summary, JSON.stringify(args), actor, userId).run();
        const id = r.meta.last_row_id as number;
        await audit(env, userId, actor, name, spec.tier, args, "pending_approval", summary, id);
        throw new ApprovalRequired(id, summary);
      }
    }
  }

  try {
    const result = await spec.handler(args, env, userId);
    await audit(env, userId, actor, name, spec.tier, args, "ok",
                typeof result === "string" ? result : JSON.stringify(result ?? "").slice(0, 500),
                approvalId);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(env, userId, actor, name, spec.tier, args, "error", msg, approvalId);
    throw e;
  }
}

/** Decide a pending approval. Approving RUNS the bound action immediately (once). */
export async function resolveApproval(env: Env, userId: string, approvalId: number,
                                      approved: boolean): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const row = await env.DB.prepare(
    "SELECT id, tool, args_json, status FROM kernel_approvals WHERE id = ? AND user_id = ?")
    .bind(approvalId, userId)
    .first<{ id: number; tool: string; args_json: string; status: string }>();
  if (!row) return { ok: false, error: "approval not found" };
  if (row.status !== "pending") return { ok: false, error: `already ${row.status}` };

  await env.DB.prepare(
    "UPDATE kernel_approvals SET status = ?, decided_by = 'user', decided_at = datetime('now') WHERE id = ?")
    .bind(approved ? "approved" : "rejected", approvalId).run();
  if (!approved) return { ok: true };

  try {
    const result = await executeTool(env, userId, row.tool,
      JSON.parse(row.args_json), "user", approvalId);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
