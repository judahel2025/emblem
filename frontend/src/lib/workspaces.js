// Connector workspaces, real in-app surfaces for connected accounts.
// Each entry lazy-loads its component (heavy deps like the code editor stay out
// of the main bundle). A connected toolkit with a registry entry gets an "Open"
// affordance on Connectors and a spot in the sidebar.
import { api } from "./api.js";

export const WORKSPACES = {
  github: {
    label: "GitHub",
    icon: "ti-brand-github",
    blurb: "Browse, edit, and push to your repos",
    load: () => import("../screens/workspaces/GithubWorkspace.svelte"),
  },
  gmail: {
    label: "Gmail",
    icon: "ti-brand-gmail",
    blurb: "Read and send from your inbox",
    load: () => import("../screens/workspaces/GmailWorkspace.svelte"),
  },
  // Google Calendar has NO workspace screen on purpose: Emblem's built-in
  // Calendar is the single calendar surface. The connector stays available so
  // Emblem can READ the user's real Google schedule (automations, proactive
  // grounding), it just doesn't add a second, duplicate calendar to the sidebar.
};

export const hasWorkspace = (slug) => Boolean(WORKSPACES[slug]);

/**
 * Run a connected-app tool through the kernel gate.
 * Reads run free; writes (act) pause for approval, onApproval(info) is called
 * with { approval_id, summary, resume() } so the workspace can show its card.
 * resume() approves and returns the executed result (or throws on decline/error).
 */
export async function runConnected(slug, params, { act = false, onApproval, retries } = {}) {
  const gate = act ? "composio.act" : "composio.read";
  // Reads auto-retry on transient/cold-connection failures (the "unable to fetch"
  // flash when a workspace first opens), 3 attempts with backoff. Actions NEVER
  // auto-retry: re-firing a send/post could double-act, so they run exactly once.
  const attempts = act ? 1 : (Number.isInteger(retries) ? retries + 1 : 3);
  let lastErr = "The connected app returned an error.";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 500 * attempt));
    let r;
    try { r = await api.execute(gate, { slug, params }); }
    catch (e) { lastErr = e?.message || lastErr; continue; }   // network blip → retry
    if (r.ok) return r.result;
    if (r.approval_required) {
      if (!onApproval) throw new Error("This needs your approval in chat.");
      return new Promise((resolve, reject) => {
        onApproval({
          approval_id: r.approval_id,
          summary: r.summary,
          approve: async () => {
            const d = await api.decide(r.approval_id, true);
            if (d.ok) resolve(d.result);
            else reject(new Error(d.error || "The action failed."));
          },
          decline: async () => {
            await api.decide(r.approval_id, false).catch(() => {});
            reject(new Error("Declined."));
          },
        });
      });
    }
    lastErr = r.error || lastErr;   // app-level error → retry (reads only)
  }
  throw new Error(lastErr);
}
