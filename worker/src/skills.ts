// Skills — named, described, reusable instructions the agent follows using its
// native tools (Anthropic's SKILL.md concept, adapted to a no-sandbox Worker).
// Progressive disclosure reproduced without a filesystem:
//   Level 1 — every turn we look at {name, description} only, cheap.
//   Level 2 — the 1-2 skills whose triggers match get their full `instructions`
//             injected for that turn.
//   Level 3 — the instructions tell the model which NATIVE tools to call.
//
// Built-in "master skills" ship here in code (invisible to users, always in the
// pool). User skills live in D1 and are managed in Settings → Skills.

import type { Env } from "./env";

export interface Skill {
  id?: number;
  name: string;
  description: string;   // WHAT + WHEN (trigger phrases) — the routing text
  instructions: string;  // the body the model follows
  source?: string;
  builtin?: boolean;
}

// Curated master skills. Descriptions are trigger-dense on purpose (the model
// routes on them). Keep instructions tight — they steer existing native tools.
export const BUILTIN_SKILLS: Skill[] = [
  {
    name: "document-designer",
    description: "Use when creating or writing ANY document, report, letter, deck, slides, " +
      "spreadsheet, or PDF (the create_document tool). Makes the output look designed, not a text dump.",
    instructions:
      "When you produce a document:\n" +
      "- Open with a clear title and a one-line summary of what it is.\n" +
      "- Organize into labelled sections with headings (##); lead each with its point.\n" +
      "- Prefer short, scannable paragraphs and bullet lists over walls of text.\n" +
      "- Keep one consistent voice; define acronyms once.\n" +
      "- For slides (pptx): one idea per slide, a strong title, 3-5 tight bullets, speaker notes.\n" +
      "- For spreadsheets (xlsx): clear headers, one concept per sheet, tidy rows.\n" +
      "- Write REAL substance — never a stub or lorem-ipsum. Then call create_document.",
  },
  {
    name: "content-writer",
    description: "Use when writing a social post, caption, tweet, LinkedIn post, email, " +
      "newsletter, or any marketing/announcement copy.",
    instructions:
      "When you write posting/marketing copy:\n" +
      "- Hook in the first line; one clear idea per piece.\n" +
      "- Natural human voice, active verbs, no fluff or hashtag spam (1-3 relevant tags max).\n" +
      "- Match the platform: tweets short, LinkedIn a touch more substance, captions punchy.\n" +
      "- End with a clear call to action when it fits.\n" +
      "- ALWAYS show the draft in chat and get the user's approval before posting. If the post " +
      "needs an image, ask them for a real one — never invent an image URL.",
  },
  {
    name: "researcher",
    description: "Use when the user asks you to research, look up, compare, or find current " +
      "information on a topic, product, company, or person.",
    instructions:
      "When researching:\n" +
      "- Use search_web across a couple of angles, not one query.\n" +
      "- Lead with the answer / key findings, then supporting detail.\n" +
      "- Attribute concrete claims to their source; include links.\n" +
      "- Flag uncertainty honestly; don't fabricate specifics or numbers.",
  },
  {
    name: "meeting-prep",
    description: "Use when the user is preparing for a meeting, call, or 1:1, or asks to get " +
      "ready for / brief them on an upcoming conversation with someone.",
    instructions:
      "When prepping a meeting:\n" +
      "- Pull the real context you can reach: upcoming calendar events, recent email threads " +
      "with the person (their connected Gmail/Calendar), relevant notes/pages.\n" +
      "- Summarize: who, when, the last touchpoint, and where things stand.\n" +
      "- List open items and 3-5 suggested talking points.\n" +
      "- Offer to draft any follow-up, but confirm before sending.",
  },
];

const norm = (s: string) => (s || "").toLowerCase();
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3);

/** Score how well a skill's trigger text matches the user's message. */
function score(skill: Skill, message: string): number {
  const hay = norm(skill.name + " " + skill.description);
  const terms = new Set(words(message));
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits++;
  // Also credit skill trigger words that appear in the message.
  const skillTerms = new Set(words(skill.description));
  const msg = norm(message);
  for (const t of skillTerms) if (msg.includes(t)) hits++;
  return hits;
}

/** Level-1 + prescreen: pick the best 1-2 skills for this message (builtin + user). */
export async function selectSkills(env: Env, userId: string, message: string, max = 2): Promise<Skill[]> {
  let userSkills: Skill[] = [];
  try {
    const rows = await env.DB.prepare(
      "SELECT id, name, description, instructions, source FROM skills WHERE user_id = ? AND enabled = 1 LIMIT 100")
      .bind(userId).all<Skill>();
    userSkills = (rows.results || []).map((r) => ({ ...r, builtin: false }));
  } catch { /* table may not exist yet */ }
  const pool = [...userSkills, ...BUILTIN_SKILLS.map((s) => ({ ...s, builtin: true }))];
  const ranked = pool
    .map((s) => ({ s, n: score(s, message) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((x) => x.s);
  return ranked;
}

/** Draft a skill from a plain-language description (the conversational builder). */
export async function draftSkill(env: Env, description: string):
    Promise<{ name: string; description: string; instructions: string } | null> {
  const { poolChat } = await import("./brainpool");
  const sys =
    "You author 'skills' for a personal AI assistant. A skill is a reusable instruction the " +
    "assistant follows. Given the user's description, output ONLY compact JSON: " +
    '{"name":"kebab-case-slug","description":"one line: WHAT it does and WHEN to use it, with ' +
    'trigger words","instructions":"clear step-by-step guidance the assistant should follow"}. ' +
    "No prose, no code fences.";
  const r = await poolChat(env, [
    { role: "system", content: sys },
    { role: "user", content: String(description).slice(0, 2000) },
  ], { maxTokens: 700 }).catch(() => null);
  if (!r) return null;
  return parseSkillJson(r.content);
}

/** Normalize a pasted SKILL.md / free-text skill into our shape. */
export async function normalizeSkill(env: Env, pasted: string):
    Promise<{ name: string; description: string; instructions: string } | null> {
  const text = String(pasted || "").trim();
  // If it's SKILL.md with frontmatter, lift name/description directly.
  const fm = text.match(/^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (fm) {
    const name = (fm[1].match(/name:\s*(.+)/)?.[1] || "").trim();
    const description = (fm[1].match(/description:\s*(.+)/)?.[1] || "").trim();
    const instructions = fm[2].trim();
    if (name && description) return { name: name.replace(/['"]/g, ""), description, instructions };
  }
  // Otherwise ask the model to normalize (also strips any bash/script steps it can't run).
  return draftSkill(env, "Convert this into a skill for a no-code-execution assistant, ignoring " +
    "any shell/script steps:\n\n" + text.slice(0, 4000));
}

function parseSkillJson(raw: string): { name: string; description: string; instructions: string } | null {
  try {
    const m = (raw || "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]);
    const name = String(o.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
    const description = String(o.description || "").slice(0, 1024);
    const instructions = String(o.instructions || "").slice(0, 8000);
    if (!name || !description) return null;
    return { name, description, instructions };
  } catch { return null; }
}
